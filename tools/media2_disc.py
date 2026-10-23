"""Read a single-track MODE1/2352 CD without mounting or running its installer."""
import hashlib
import argparse
import json
import struct
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_zips(media, sources):
    hashes = {s['path']: s['sha256'] for s in sources}
    containers = []
    for path in sorted(Path(media).glob('*.zip')):
        members = []
        with ZipFile(path) as archive:
            for info in archive.infolist():
                name = PurePosixPath(info.filename)
                if name.is_absolute() or '..' in name.parts or '\\' in info.filename:
                    raise ValueError('Unsafe outer ZIP member path')
                if info.is_dir():
                    continue
                with archive.open(info) as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                if hashes.get(info.filename) != digest:
                    raise ValueError(f'Outer ZIP member differs from extracted source: {info.filename}')
                members.append(dict(path=info.filename, bytes=info.file_size, sha256=digest,
                                    zipHeaderOffset=info.header_offset, compressedBytes=info.compress_size))
        containers.append(dict(path=path.name, members=members))
    return containers


class Disc:
    sector_size = 2352
    user_offset = 16
    block_size = 2048

    def __init__(self, path):
        self.path = Path(path)
        self.stream = self.path.open('rb')
        self.size = self.path.stat().st_size
        if self.size % self.sector_size:
            self.close()
            raise ValueError('Truncated MODE1/2352 image')
        self.user_size = self.size // self.sector_size * self.block_size
        try:
            descriptor = self.read(16 * 2048, 2048)
        except Exception:
            self.close()
            raise
        if descriptor[:7] != b'\x01CD001\x01' or struct.unpack_from('<H', descriptor, 128)[0] != 2048:
            self.close()
            raise ValueError('Expected primary ISO9660 volume with 2048-byte blocks')
        self.volume = descriptor[40:72].decode('ascii').strip()
        self.root = self.record(descriptor[156:156 + descriptor[156]])

    def close(self):
        self.stream.close()

    def read(self, offset, size):
        if offset < 0 or size < 0 or offset + size > self.user_size:
            raise ValueError('ISO extent outside image')
        out = bytearray()
        while size:
            block, within = divmod(offset, 2048)
            self.stream.seek(block * 2352)
            header = self.stream.read(16)
            if header[:12] != b'\x00' + b'\xff' * 10 + b'\x00' or header[15] != 1:
                raise ValueError(f'Invalid MODE1 sector {block}')
            count = min(size, 2048 - within)
            self.stream.seek(within, 1)
            data = self.stream.read(count)
            if len(data) != count:
                raise ValueError('Truncated CD sector')
            out.extend(data)
            size -= count
            offset += count
        return bytes(out)

    @staticmethod
    def record(raw):
        if len(raw) < 34 or raw[0] != len(raw) or 33 + raw[32] > len(raw):
            raise ValueError('Invalid ISO directory record')
        extent, = struct.unpack_from('<I', raw, 2)
        size, = struct.unpack_from('<I', raw, 10)
        if extent != struct.unpack_from('>I', raw, 6)[0] or size != struct.unpack_from('>I', raw, 14)[0]:
            raise ValueError('Mismatched ISO dual-endian extent')
        if raw[1] or raw[26] or raw[27] or raw[25] & 0x80:
            raise ValueError('Unsupported extended/interleaved/multiextent ISO file')
        return dict(extent=extent, bytes=size, directory=bool(raw[25] & 2), name=raw[33:33 + raw[32]])

    def files(self):
        visited = set()

        def walk(directory, prefix):
            key = directory['extent']
            if key in visited or len(visited) > 10000:
                raise ValueError('ISO directory cycle or excessive directory count')
            visited.add(key)
            data = self.read(key * 2048, directory['bytes'])
            pos = 0
            names = set()
            while pos < len(data):
                length = data[pos]
                if not length:
                    pos = (pos // 2048 + 1) * 2048
                    continue
                if pos % 2048 + length > 2048:
                    raise ValueError('ISO directory record crosses sector')
                row = self.record(data[pos:pos + length])
                pos += length
                if row['name'] in (b'\0', b'\1'):
                    continue
                name = row.pop('name').decode('ascii').split(';')[0]
                if not name or name in ('.', '..') or '/' in name or '\\' in name or ':' in name or name.casefold() in names:
                    raise ValueError('Unsafe or duplicate ISO path')
                names.add(name.casefold())
                path = prefix / name
                if row['extent'] * 2048 + row['bytes'] > self.user_size:
                    raise ValueError(f'ISO file outside image: {path}')
                if row.pop('directory'):
                    yield from walk({**row, 'directory': True}, path)
                else:
                    yield dict(path=str(path), **row)

        yield from walk(self.root, PurePosixPath())

    def extract(self, row, destination):
        target = Path(destination) / row['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with target.open('wb') as output:
            offset, remaining = row['extent'] * 2048, row['bytes']
            while remaining:
                size = min(1024 * 1024, remaining)
                block = self.read(offset, size)
                output.write(block)
                digest.update(block)
                remaining -= size
                offset += size
        return dict(**row, sha256=digest.hexdigest(), binUserOffset=row['extent'] * 2352 + 16)


def extract_media(media, output):
    media, output = Path(media).resolve(), Path(output).resolve()
    if output == media or media in output.parents or output in media.parents:
        raise ValueError('Disc output must be separate from source media')
    images = sorted(media.glob('*/Game Files/*.BIN'))
    if len(images) != 2:
        raise ValueError('Expected exactly two Media2 BIN images')
    sources = []
    for path in sorted(media.rglob('*')):
        if path.is_file():
            sources.append(dict(path=str(path.relative_to(media)), bytes=path.stat().st_size, sha256=sha256(path)))
    outer = verify_zips(media, sources)
    discs = []
    for path in images:
        cue = path.with_suffix('.CUE')
        expected = f'FILE "{path.name}" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n'
        if cue.read_text() != expected:
            raise ValueError(f'Unsupported CUE layout: {cue.name}')
        disc = Disc(path)
        try:
            rows = [disc.extract(row, output / disc.volume) for row in disc.files()]
            discs.append(dict(image=str(path.relative_to(media)), volume=disc.volume, files=rows))
        finally:
            disc.close()
        print(f'{disc.volume}: extracted {len(rows)} files', flush=True)
    manifest = dict(schemaVersion=1, format='ISO9660 primary volume, MODE1/2352, 2048 user bytes at +16',
                    sources=sources, outerZipVerification=outer, discs=discs)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'disc-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('media', type=Path)
    parser.add_argument('--output', type=Path, default=Path('build/media2/discs'))
    args = parser.parse_args()
    extract_media(args.media, args.output)
