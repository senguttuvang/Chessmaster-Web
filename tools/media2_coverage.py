"""Map original references and summarize exactly the recovered audio surfaces."""
from bisect import bisect_right
from collections import Counter, defaultdict
import hashlib
import json
import re
import io
import wave
from pathlib import Path

import pefile

from media2_disc import sha256
from recover import records


EVENTS = ('WhiteMove', 'BlackMove', 'Check', 'Checkmate', 'Capture', 'Castle', 'Promotion',
          'Draw', 'ChessBeep', 'IllegalMove', 'ChatTell', 'Announce', 'Challenge', 'BuddyLogin', 'WindowClose')


def compare_prior(game, output, manifest):
    """Only the named prior archives/default WAVs; never recurse into USERS."""
    game, output = Path(game), Path(output)
    files = {p.name.casefold(): p for p in game.iterdir() if p.is_file()}
    archives = []
    for archive in manifest['archives']:
        idx = files.get(Path(archive['index']).name.casefold())
        dat = files.get(Path(archive['data']).name.casefold())
        if idx is None or dat is None:
            archives.append(dict(index=archive['index'], priorAvailable=False))
            continue
        rows = list(records(idx.read_bytes()))
        size = dat.stat().st_size
        archives.append(dict(index=archive['index'], priorIndex=idx.name, priorData=dat.name,
                             priorIndexSha256=sha256(idx), priorDataSha256=sha256(dat), priorDataBytes=size,
                             sameIndex=sha256(idx) == archive['indexSha256'],
                             samePayload=sha256(dat) == archive['dataSha256'], priorMembers=len(rows),
                             priorAvailableMembers=sum(o >= 32 and n > 0 and o + n <= size for _, _, o, _, n in rows)))
    waves = []
    sound_dir = game / 'OPENING_'
    # Match source audio prefixes against the old exported default event sounds.
    # The old DLL wrapper's final chunk is not used as a decoding oracle.
    candidates = []
    for clip in manifest['clips']:
        if clip['group'] == 'cmsets':
            with wave.open(io.BytesIO((output / 'catalogue' / clip['playable']).read_bytes()), 'rb') as stream:
                candidates.append((clip, stream.readframes(stream.getnframes())))
    for path in sorted(sound_dir.glob('*.WAV')):
        with wave.open(str(path), 'rb') as stream:
            raw = stream.readframes(stream.getnframes())
        matches = []
        for clip, pcm in candidates:
            prefix = min(len(pcm), len(raw)) - 64
            if abs(len(pcm) - len(raw)) <= 2 and prefix > 128 and pcm[:prefix] == raw[:prefix]:
                mismatch = next((i for i, pair in enumerate(zip(pcm, raw)) if pair[0] != pair[1]), min(len(pcm), len(raw)))
                matches.append(dict(clip=clip['id'], identicalPrefixBytes=mismatch,
                                    priorPcmBytes=len(raw), recoveredPcmBytes=len(pcm)))
        waves.append(dict(filename=path.name, priorSha256=sha256(path), matches=matches))
    return dict(schemaVersion=1, scope='Named top-level archives and OPENING_/*.WAV only; no profiles', archives=archives, eventWaves=waves)


def reference_map(output, manifest):
    lookup = defaultdict(list)
    for clip in manifest['clips']:
        lookup[clip['name'].casefold()].append(clip['id'])
        for origin in clip.get('duplicateOrigins', []):
            alias = Path(origin['file']).name.casefold()
            if clip['id'] not in lookup[alias]:
                lookup[alias].append(clip['id'])

    def resolve(name, preferred):
        candidates = lookup.get((name if name.casefold().endswith('.raw') else name + '.raw').casefold(), [])
        preferred_ids = [c for c in candidates if c.startswith(preferred + ':')]
        return preferred_ids or candidates

    sources, references = [], []
    for folder, preferred in [('Shared/Tutorials', 'tutorial'), ('Shared/Josh_Games', 'jwaudio')]:
        for path in sorted((output / 'install' / folder).rglob('*')):
            if not path.is_file():
                continue
            raw = path.read_bytes()
            source = str(path.relative_to(output))
            sources.append(dict(path=source, sha256=sha256(path), bytes=len(raw)))
            steps = list(re.finditer(rb'(?m)^\s*(\d+)\.\s*\r?\n', raw)) if preferred == 'tutorial' else []
            offsets = [s.start() for s in steps]
            for match in re.finditer(rb'\{W:([^{}]*)\}', raw):
                name = match[1].decode('cp1252')
                step = bisect_right(offsets, match.start()) - 1
                references.append(dict(source=source, byteOffset=match.start(), reference=name,
                                       step=int(steps[step][1]) if step >= 0 else None,
                                       matches=resolve(name, preferred)))
    # The program's 15 fixed 256-byte filename slots, indexed by FUN_004245ea.
    module = output / 'install/program/Chessmaster.exe'
    pe = pefile.PE(str(module))
    base = pe.OPTIONAL_HEADER.ImageBase
    events = []
    for number, event in enumerate(EVENTS):
        va = 0x5953a8 + number * 256
        filename = pe.get_data(va - base, 256).split(b'\0')[0].decode('ascii')
        events.append(dict(event=event, number=number, filename=filename, va=hex(va),
                           fileOffset=pe.get_offset_from_rva(va - base), matches=lookup.get(filename.casefold(), [])))
    pe.close()
    prior = Path(__file__).resolve().parents[1] / 'recovery/content/tutorial'
    prior_hashes = {sha256(p): p.name for p in prior.glob('*.TUT')}
    prior_comparison = [dict(source=s['path'], identicalPriorLesson=prior_hashes.get(s['sha256']))
                        for s in sources if '/Tutorials/' in s['path']]
    return dict(schemaVersion=1, policy='Exact case-insensitive ID + .raw; prefer source namespace; no typo repair',
                sources=sources, references=references, eventModuleSha256=sha256(module),
                eventHandler='0x004245ea', events=events, priorLessonComparison=prior_comparison,
                pieceSoundSets=[dict(name=e['name'], references=e['soundReferences']) for a in manifest['archives']
                                for e in a['entries'] if e.get('soundReferences')])


def summarize(output, manifest, references):
    groups = {}
    for group in sorted({c['group'] for c in manifest['clips']}):
        clips = [c for c in manifest['clips'] if c['group'] == group]
        groups[group] = dict(clips=len(clips), sourceBytes=sum(c['sourceBytes'] for c in clips),
                             durationSeconds=round(sum(c['metadata']['duration'] for c in clips), 6),
                             codecs=dict(Counter(c['metadata']['codec'] for c in clips)),
                             formats=dict(Counter(f'{c["metadata"]["sampleRate"]} Hz / {c["metadata"]["channels"]} ch' for c in clips)))
    duplicates = defaultdict(list)
    for clip in manifest['clips']:
        duplicates[clip['sourceSha256']].append(clip['id'])
    unresolved = [r for r in references['references'] if not r['matches']]
    defects = [dict(id=c['id'], origin=c['origin'], metadata=c['metadata'], sourceSha256=c['sourceSha256'])
               for c in manifest['clips'] if c['metadata'].get('truncatedTailBytes') or c['metadata'].get('missingDeclaredSamples')]
    return dict(schemaVersion=1, scope='Both primary ISO filesystems; recursive supported ZIP/CAB/SFX; all 8 ChessmasterDat01 indices; all PKZP members; loose header signatures; every enumerated PE resource',
                coverageLimits=['No proof about arbitrary unidentified obfuscated data or original GUI scheduling',
                                'MP3 decode validation uses concat after independent frame parsing; browser checks sample every group',
                                'No human listening; raw ADPC rate/type inferred from static Miles callsites, transform proven independently'],
                groups=groups, clips=len(manifest['clips']), uniqueSourcePayloads=len(duplicates),
                sourceBytes=sum(c['sourceBytes'] for c in manifest['clips']),
                durationSeconds=round(sum(c['metadata']['duration'] for c in manifest['clips']), 6),
                duplicateContentGroups=[v for v in duplicates.values() if len(v) > 1],
                archives=[{k: v for k, v in a.items() if k != 'entries'} for a in manifest['archives']],
                filesInventoried=len(manifest['files']), peModulesScanned=len(manifest['peResources']),
                illustrations=len(manifest['illustrations']), extractionErrors=manifest['errors'],
                sourceDefects=defects, referenceOccurrences=len(references['references']),
                resolvedReferenceOccurrences=len(references['references']) - len(unresolved),
                ambiguousReferenceOccurrences=sum(len(r['matches']) > 1 for r in references['references']),
                unresolvedReferences=unresolved, events=references['events'],
                identicalPriorLessons=sum(bool(r['identicalPriorLesson']) for r in references['priorLessonComparison']),
                changedPriorLessons=[r['source'] for r in references['priorLessonComparison'] if not r['identicalPriorLesson']],
                manifestSha256=sha256(output / 'catalogue/manifest.json'),
                referencesSha256=sha256(output / 'catalogue/references.json'))


def write_catalogue(output, manifest):
    output = Path(output)
    references = reference_map(output, manifest)
    (output / 'catalogue/references.json').write_text(json.dumps(references, indent=2) + '\n')
    summary = summarize(output, manifest, references)
    (output / 'catalogue/coverage.json').write_text(json.dumps(summary, indent=2) + '\n')
    related = defaultdict(list)
    for ref in references['references']:
        for clip in ref['matches']:
            related[clip].append({k: v for k, v in ref.items() if k != 'matches'})
    index = dict(schemaVersion=1, summary={k: v for k, v in summary.items() if k not in ('archives', 'duplicateContentGroups', 'sourceDefects')},
                 clips=[dict(**c, references=related[c['id']]) for c in manifest['clips']], illustrations=manifest['illustrations'])
    (output / 'catalogue/index.json').write_text(json.dumps(index, separators=(',', ':')) + '\n')
    template = Path(__file__).resolve().parent / 'audio-catalogue'
    for path in template.iterdir():
        if path.is_file():
            (output / 'catalogue' / path.name).write_bytes(path.read_bytes())
    return summary
