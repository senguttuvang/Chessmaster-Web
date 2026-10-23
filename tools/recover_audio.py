"""One-command, read-only Media2 recovery into an ignored local audio catalogue."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import ctypes
import hashlib
import json
import re
import subprocess
from pathlib import Path

import pefile

from media2_codecs import adpc_audio, mp3_header, mp3_metadata, wav_metadata
from media2_containers import expand
from media2_disc import extract_media, sha256
from recover import records

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def concat_file(path):
    value = str(Path(path).resolve())
    if '\n' in value or '\r' in value:
        raise ValueError('Newlines are unsupported in concat file paths')
    return "file '" + value.replace("'", "'\\''") + "'\n"


class Blast:
    def __init__(self):
        libpath = ROOT / 'build/libblast.dylib'
        libpath.parent.mkdir(exist_ok=True)
        subprocess.run(['cc', '-shared', '-fPIC', '-O2', '-Ivendor/blast', 'tools/blast_decode.c',
                        'vendor/blast/blast.c', '-o', str(libpath)], cwd=ROOT, check=True)
        self.lib = ctypes.CDLL(str(libpath))
        self.lib.blast_decode.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
        self.lib.blast_decode.restype = ctypes.c_int

    def decode(self, raw, size):
        if not 0 < size <= 64 * 1024 * 1024:
            raise ValueError('Invalid PKWARE output size')
        target = ctypes.create_string_buffer(size)
        actual = self.lib.blast_decode(raw, len(raw), target, size)
        if actual != size:
            raise ValueError(f'PKWARE decode length {actual}, expected {size}')
        return target.raw


def checked_records(raw, size):
    rows = list(records(raw))
    ranges = []
    for name, codec, offset, unpacked, packed in rows:
        if not name or offset < 32 or packed <= 0 or offset + packed > size or not 0 < unpacked <= 64 * 1024 * 1024:
            raise ValueError(f'Invalid archive member/range: {name}')
        ranges.append((offset, offset + packed))
    for previous, current in zip(sorted(ranges), sorted(ranges)[1:]):
        if previous[1] > current[0]:
            raise ValueError('Overlapping archive payloads')
    return rows


def signature(raw):
    if raw[:4] == b'RIFF' and raw[8:12] == b'WAVE':
        return 'wave'
    if raw[:3] in (b'BIK', b'KB2') or raw[:4] == b'RIFF' and raw[8:12] == b'AVI ':
        return 'video'
    if mp3_header(raw):
        return 'mp3-candidate'
    if raw[:2] == b'BM':
        return 'bitmap'
    return 'other'


def file_format(path):
    with path.open('rb') as stream:
        raw = stream.read(32)
    kind = signature(raw)
    if kind != 'other':
        return kind
    for magic, name in [(b'ISc(', 'InstallShield cabinet/header'), (b'MSCF', 'Microsoft cabinet'),
                        (b'PK\x03\x04', 'ZIP'), (b'MZ', 'DOS/PE executable'), (b'%PDF', 'PDF')]:
        if raw.startswith(magic):
            return name
    if raw[4:20] == b'ChessmasterDat01':
        return 'ChessmasterDat01'
    return 'other; extension ' + path.suffix.lower()


def source_files(output, container_manifest):
    roots = [output / 'discs', output / 'install']
    roots += [output / c['output'] for c in container_manifest['containers'] if c.get('output') and c['output'] != 'install']
    return sorted(set(p for root in roots for p in root.rglob('*') if p.is_file()))


def verify_reuse(output, media, containers):
    discs = json.loads((output / 'discs/disc-manifest.json').read_text())
    for source in discs['sources']:
        if sha256(media / source['path']) != source['sha256']:
            raise ValueError('Changed source media')
    for disc in discs['discs']:
        for row in disc['files']:
            if sha256(output / 'discs' / disc['volume'] / row['path']) != row['sha256']:
                raise ValueError('Changed extracted disc member')
    for container in containers['containers']:
        if sha256(output / container['source']) != container['sha256']:
            raise ValueError('Changed container input')
        for row in container.get('files', []):
            if sha256(output / container['output'] / row['path']) != row['sha256']:
                raise ValueError('Changed extracted container member')


def extract_clips(output, containers):
    catalogue = output / 'catalogue'
    catalogue.mkdir(parents=True, exist_ok=True)
    files = source_files(output, containers)
    file_rows = [dict(path=str(p.relative_to(output)), bytes=p.stat().st_size, sha256=sha256(p), format=file_format(p)) for p in files]
    blast = Blast()
    clips, archives, errors, resources, illustrations = [], [], [], [], []
    group_counts = Counter()

    def emit(raw, namespace, name, origin, codec=None, declared=None):
        number = group_counts[namespace]
        stem = f'audio/{namespace}/{number:05}'
        kind = signature(raw)
        if codec == 'ADPC':
            decoded, derivative, metadata = adpc_audio(raw, declared)
            source = stem + '.adpc'
            playable = stem + '.wav'
            (catalogue / source).parent.mkdir(parents=True, exist_ok=True)
            (catalogue / (stem + '.decoded.pcm')).write_bytes(decoded)
        elif codec == 'MP3 ' or kind == 'mp3-candidate':
            metadata = mp3_metadata(raw, allow_truncated=True)
            source = playable = stem + '.mp3'
            derivative = raw
            if metadata.get('truncatedTailBytes'):
                source = stem + '.source.mp3'
                derivative = raw[:metadata['completeBytes']]
        elif kind == 'wave':
            metadata = wav_metadata(raw)
            source = stem + '.source.wav'
            playable = stem + '.wav'
            derivative = None  # FFmpeg validates and converts all complete WAVE streams.
        elif kind == 'video':
            source = stem + ('.bik' if raw[:3] == b'BIK' else '.avi')
            (catalogue / source).parent.mkdir(parents=True, exist_ok=True)
            (catalogue / source).write_bytes(raw)
            streams = [s for s in probe(catalogue / source)['streams'] if s['codec_type'] == 'audio']
            if not streams:
                return None
            if len(streams) != 1:
                raise ValueError('Multiple video soundtracks need explicit recovery')
            stream = streams[0]
            metadata = dict(codec=stream['codec_name'], sampleRate=int(stream['sample_rate']), channels=stream['channels'])
            playable, derivative = stem + '.wav', None
        else:
            raise ValueError(f'Unrecognized audio source: {name} ({codec})')
        (catalogue / source).parent.mkdir(parents=True, exist_ok=True)
        (catalogue / source).write_bytes(raw)
        if derivative is not None:
            (catalogue / playable).write_bytes(derivative)
        item = dict(id=f'{namespace}:{name}', group=namespace, name=name, source=source, playable=playable,
                    sourceBytes=len(raw), sourceSha256=hashlib.sha256(raw).hexdigest(), origin=origin,
                    metadata=metadata, needsConversion=derivative is None)
        if codec == 'ADPC':
            item['completeTransform'] = stem + '.decoded.pcm'
            item['transformSha256'] = hashlib.sha256(decoded).hexdigest()
        clips.append(item)
        group_counts[namespace] += 1
        return item

    program = output / 'install/program'
    for idx in sorted(program.iterdir()):
        if idx.suffix.lower() != '.idx' or idx.read_bytes()[4:20] != b'ChessmasterDat01':
            continue
        candidates = [p for p in files if p.name.lower() == idx.with_suffix('.dat').name.lower()]
        if not candidates:
            raise ValueError(f'No data for {idx.name}')
        dat = max(candidates, key=lambda p: p.stat().st_size)
        rows = checked_records(idx.read_bytes(), dat.stat().st_size)
        group = idx.stem.lower()
        archive = dict(index=str(idx.relative_to(output)), data=str(dat.relative_to(output)),
                       indexSha256=sha256(idx), dataSha256=sha256(dat), dataBytes=dat.stat().st_size,
                       members=len(rows), codecs=dict(Counter(r[1] for r in rows)),
                       duplicateNames=[n for n, c in Counter(r[0].casefold() for r in rows).items() if c > 1],
                       unusedBytes=dat.stat().st_size - 32 - sum(r[4] for r in rows), entries=[])
        with dat.open('rb') as stream:
            for ordinal, (name, codec, offset, unpacked, packed) in enumerate(rows):
                stream.seek(offset)
                raw = stream.read(packed)
                origin = dict(index=archive['index'], archive=archive['data'], ordinal=ordinal,
                              offset=offset, packed=packed, declaredUnpacked=unpacked, archiveCodec=codec)
                entry = dict(name=name, **origin, sha256=hashlib.sha256(raw).hexdigest())
                try:
                    if codec in ('ADPC', 'IMAP', 'MP3 '):
                        clip = emit(raw, group, name, origin, codec, unpacked)
                        entry['clip'] = clip['id']
                    elif codec == 'PKZP':
                        decoded = blast.decode(raw, unpacked)
                        entry.update(decodedSha256=hashlib.sha256(decoded).hexdigest(), signature=signature(decoded))
                        if signature(decoded) in ('wave', 'mp3-candidate', 'video'):
                            clip = emit(decoded, group, name, origin)
                            entry['clip'] = clip['id'] if clip else None
                        if group == 'tutorial' and decoded[:2] == b'BM':
                            path = f'illustrations/{ordinal:05}.bmp'
                            (catalogue / path).parent.mkdir(parents=True, exist_ok=True)
                            (catalogue / path).write_bytes(decoded)
                            illustrations.append(dict(name=name, path=path, origin=origin, sha256=entry['decodedSha256']))
                        if group == 'cmsets' and name.lower().endswith('.ini'):
                            entry['soundReferences'] = re.findall(r'(?im)^([^;\r\n=]*(?:sound|wav|move|capture|check|castle|draw|mate|promo)[^=\r\n]*)=(.*)$', decoded.decode('cp1252'))
                    else:
                        raise ValueError(f'Unsupported archive codec {codec}')
                except (ValueError, RuntimeError) as error:
                    errors.append(dict(source=origin, name=name, error=str(error)))
                archive['entries'].append(entry)
        archives.append(archive)
        print(f'{idx.name}: audited {len(rows)} members', flush=True)

    # Header classification catches autorun .DAW sounds despite their nonstandard extension.
    seen_loose = {}
    for path in files:
        with path.open('rb') as stream:
            header = stream.read(16)
        kind = signature(header)
        if kind in ('wave', 'video', 'mp3-candidate') or path.suffix.lower() in ('.wav', '.mp3', '.bik', '.avi', '.ogg', '.aif', '.aiff', '.wma', '.mid', '.rmi'):
            origin = dict(file=str(path.relative_to(output)), offset=0)
            digest = sha256(path)
            if digest in seen_loose:
                seen_loose[digest]['duplicateOrigins'].append(origin)
                continue
            try:
                group = 'loose' if path.is_relative_to(output / 'install') else 'disc-extra' if path.is_relative_to(output / 'discs') else 'redistributable'
                clip = emit(path.read_bytes(), group, path.name, origin)
                if clip:
                    clip['duplicateOrigins'] = []
                    seen_loose[digest] = clip
            except (ValueError, subprocess.CalledProcessError) as error:
                errors.append(dict(source=origin, error=str(error)))
        if header[:2] != b'MZ':
            continue
        try:
            pe = pefile.PE(str(path))
        except pefile.PEFormatError:
            continue
        row = dict(file=str(path.relative_to(output)), sha256=sha256(path), types=[], media=[])
        for resource_type in getattr(getattr(pe, 'DIRECTORY_ENTRY_RESOURCE', None), 'entries', []):
            row['types'].append(str(resource_type.name or resource_type.id))
            for resource in resource_type.directory.entries:
                for language in resource.directory.entries:
                    data = language.data.struct
                    raw = pe.get_data(data.OffsetToData, data.Size)
                    if signature(raw) not in ('wave', 'video', 'mp3-candidate'):
                        continue
                    origin = dict(file=row['file'], type=str(resource_type.name or resource_type.id),
                                  resource=str(resource.name or resource.id), language=language.id,
                                  rva=data.OffsetToData, offset=pe.get_offset_from_rva(data.OffsetToData), bytes=data.Size)
                    try:
                        clip = emit(raw, 'resources', f'{row["file"]}/{origin["type"]}/{origin["resource"]}/{language.id}', origin)
                        row['media'].append(dict(origin=origin, clip=clip['id'] if clip else None))
                    except (ValueError, subprocess.CalledProcessError) as error:
                        errors.append(dict(source=origin, error=str(error)))
        resources.append(row)
        pe.close()
    if len({c['id'] for c in clips}) != len(clips):
        raise ValueError('Duplicate catalogue clip IDs')
    return dict(schemaVersion=1, files=file_rows, archives=archives, clips=clips,
                peResources=resources, illustrations=illustrations, errors=errors)


def convert_and_verify(output, manifest):
    catalogue = output / 'catalogue'
    logs = output / 'logs'

    def convert(clip):
        if not clip.pop('needsConversion'):
            return
        source, target = catalogue / clip['source'], catalogue / clip['playable']
        command = ['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-y',
                   '-i', str(source), '-map', '0:a:0']
        if clip['metadata'].get('paddingSamples'):
            command += ['-af', f'atrim=end_sample={clip["metadata"]["samples"]}']
        command += ['-c:a', 'pcm_s16le', '-bitexact', str(target)]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode or result.stderr:
            raise ValueError(f'{clip["id"]}: FFmpeg decode failed: {result.stderr[:500]}')
        metadata = wav_metadata(target.read_bytes())
        original = clip['metadata']
        if any(original.get(k, metadata[k]) != metadata[k] for k in ('sampleRate', 'channels', 'samples')):
            raise ValueError(f'{clip["id"]}: decoded sample/format disagreement: {original} / {metadata}')
        clip['decodedMetadata'] = metadata
        original.setdefault('samples', metadata['samples'])
        original.setdefault('duration', metadata['duration'])
        clip['conversion'] = command

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(convert, manifest['clips']))
    validation = []
    for group in sorted({c['group'] for c in manifest['clips'] if c['metadata']['codec'] == 'mp3'}):
        clips = [c for c in manifest['clips'] if c['group'] == group and c['metadata']['codec'] == 'mp3']
        listing = logs / f'{group}-mp3-concat.txt'
        listing.write_text(''.join(concat_file(catalogue / c['playable']) for c in clips))
        command = ['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode',
                   '-f', 'concat', '-safe', '0', '-i', str(listing), '-map', '0:a:0', '-f', 'null', '-']
        result = subprocess.run(command, capture_output=True, text=True)
        (logs / f'{group}-mp3-decode.log').write_text(result.stderr)
        if result.returncode or result.stderr:
            raise ValueError(f'{group}: full MP3 decode failed; see logs/{group}-mp3-decode.log')
        validation.append(dict(group=group, files=len(clips), command=command, exitCode=0,
                               stderrBytes=0, scope='Every frame parsed independently; all clips decoded through FFmpeg concat demuxer'))
        print(f'{group}: FFmpeg decoded {len(clips)} MP3 clips', flush=True)
    for clip in manifest['clips']:
        path = catalogue / clip['playable']
        clip['playableBytes'], clip['playableSha256'] = path.stat().st_size, sha256(path)
    return validation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('media', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'build/media2')
    parser.add_argument('--reuse-containers', action='store_true', help='Reuse hash-verified prior extraction (local iteration only)')
    parser.add_argument('--prior-install', type=Path, help='Compare named prior archives/default event WAVs read-only; excludes profiles')
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / 'build'):
        parser.error('Output must be inside this worktree build/ directory')
    if args.reuse_containers:
        containers = json.loads((output / 'container-manifest.json').read_text())
        verify_reuse(output, args.media.resolve(), containers)
    else:
        extract_media(args.media, output / 'discs')
        containers = expand(output)
    manifest = extract_clips(output, containers)
    write_json(output / 'catalogue/manifest.json', manifest)
    if manifest['errors']:
        raise ValueError(f'{len(manifest["errors"])} extraction errors; see catalogue/manifest.json')
    manifest['decodeValidation'] = convert_and_verify(output, manifest)
    manifest['toolVersions'] = {}
    for name, command in [('ffmpeg', ['ffmpeg', '-version']), ('unshield', ['unshield', '-V']), ('7zz', ['7zz', 'i'])]:
        version = subprocess.run(command, capture_output=True, text=True, check=True)
        manifest['toolVersions'][name] = next(line for line in (version.stdout + version.stderr).splitlines() if line.strip())
    write_json(output / 'catalogue/manifest.json', manifest)
    from media2_coverage import write_catalogue
    if args.prior_install:
        from media2_coverage import compare_prior
        write_json(output / 'catalogue/prior-comparison.json', compare_prior(args.prior_install, output, manifest))
    summary = write_catalogue(output, manifest)
    print(json.dumps({k: summary[k] for k in ('clips', 'durationSeconds', 'extractionErrors', 'referenceOccurrences', 'resolvedReferenceOccurrences')}), flush=True)
    print(f'Recovered {len(manifest["clips"])} audio clips; catalogue: {output / "catalogue"}', flush=True)


if __name__ == '__main__':
    main()
