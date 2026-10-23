"""Stage own-media catalogue assets for the private browser app; never commit payloads."""
import argparse
import json
import os
from pathlib import Path
import shutil
import re

from PIL import Image

from media2_disc import sha256

ROOT = Path(__file__).resolve().parents[1]
EVENTS = {
    'WhiteMove': 'cmsets:WMove.raw', 'BlackMove': 'cmsets:BMove.raw',
    'Capture': 'cmsets:Capture.raw', 'Castle': 'cmsets:castle.raw',
    'Check': 'cmsets:check.raw', 'Checkmate': 'cmsets:checkmate.raw',
    'Promotion': 'cmsets:promote.raw', 'Draw': 'cmsets:draw.raw',
    'IllegalMove': 'loose:Illegal.wav',
}


def stage(catalogue):
    catalogue = Path(catalogue).resolve()
    manifest = json.loads((catalogue / 'manifest.json').read_text())
    if manifest['errors'] or not manifest.get('decodeValidation'):
        raise ValueError('Use a fully verified recovery catalogue')
    target = ROOT / 'web/public/audio'
    target.mkdir(parents=True, exist_ok=True)
    clips = {}
    for clip in manifest['clips']:
        if not re.fullmatch(r'[a-z0-9_-]+', clip['group']) or clip['id'] in clips:
            raise ValueError('Invalid or duplicate audio identity')
        source = (catalogue / clip['playable']).resolve()
        if not source.is_relative_to(catalogue) or source.suffix not in ('.mp3', '.wav') or sha256(source) != clip['playableSha256']:
            raise ValueError(f'Invalid playable source: {clip["id"]}')
        relative = Path('clips') / clip['group'] / (clip['playableSha256'] + source.suffix)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            try:
                os.link(source, destination)
            except OSError:
                shutil.copyfile(source, destination)
        elif sha256(destination) != clip['playableSha256']:
            raise ValueError(f'Changed staged asset: {destination}')
        clips[clip['id']] = dict(url='/audio/' + relative.as_posix(), duration=clip['metadata']['duration'],
                                 partial=bool(clip['metadata'].get('truncatedTailBytes') or clip['metadata'].get('missingDeclaredSamples')))
    for event, clip in EVENTS.items():
        if clip not in clips:
            raise ValueError(f'Missing original event sound: {event}/{clip}')
    images = {}
    for image in manifest['illustrations']:
        source = (catalogue / image['path']).resolve()
        if not source.is_relative_to(catalogue) or sha256(source) != image['sha256']:
            raise ValueError('Invalid original illustration')
        relative = Path('illustrations') / (image['sha256'] + '.png')
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as bitmap:
            bitmap.convert('RGB').save(destination)
        images[image['name'].casefold()] = '/audio/' + relative.as_posix()
    index = dict(schemaVersion=1, provenance=sha256(catalogue / 'manifest.json'), clips=clips,
                 events=EVENTS, images=images)
    (target / 'index.json').write_text(json.dumps(index, separators=(',', ':')) + '\n')
    print(f'Staged {len(clips)} original clips and {len(images)} illustrations in {target}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalogue', type=Path)
    stage(parser.parse_args().catalogue)
