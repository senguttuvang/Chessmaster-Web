"""Statically expand known installer/archive formats; record every command/member."""
import json
import re
import subprocess
from pathlib import Path

from media2_disc import sha256


def run(command, log):
    result = subprocess.run([str(s) for s in command], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    Path(log).write_bytes(result.stdout)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}); see {log}: {command[0]}')
    return result.stdout.decode(errors='replace')


def expand(output):
    output = Path(output)
    logs = output / 'logs'
    logs.mkdir(parents=True, exist_ok=True)
    containers = []
    scanned = set()
    extracted = {}
    queue = sorted((output / 'discs').rglob('*'))
    while queue:
        path = queue.pop(0)
        if not path.is_file() or path.suffix.lower() not in ('.cab', '.zip', '.exe', '.ex_', '.dll'):
            continue
        digest = sha256(path)
        if digest in scanned:
            if digest in extracted:
                containers.append(dict(source=str(path.relative_to(output)), sha256=digest, duplicateOf=extracted[digest]))
            continue
        scanned.add(digest)
        with path.open('rb') as stream:
            magic = stream.read(4)
        kind = None
        if magic == b'ISc(':
            if path.name.upper() not in ('DATA1.CAB', '_SYS1.CAB', '_USER1.CAB'):
                # InstallShield continuation volumes are consumed by data1.cab.
                containers.append(dict(source=str(path.relative_to(output)), sha256=digest,
                                       kind='InstallShield continuation', bytes=path.stat().st_size))
                continue
            kind = 'InstallShield'
        elif magic in (b'MSCF', b'PK\x03\x04'):
            kind = '7-Zip'
        elif magic[:2] == b'MZ':
            result = subprocess.run(['7zz', 'l', '-slt', str(path)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            listing = result.stdout.decode(errors='replace')
            (logs / f'{digest[:16]}-list.log').write_text(listing)
            types = re.findall(r'^Type = (.+)$', listing, re.M)
            if result.returncode == 0 and types and types[-1] not in ('PE', 'TE'):
                kind = '7-Zip SFX'
        if kind is None:
            continue
        # Stable convenient directory for the game's main installer.
        target = output / ('install' if path == output / 'discs/CM9000_1/DATA1.CAB'
                           else f'containers/{digest[:16]}')
        command = (['unshield', '-d', str(target), 'x', str(path)] if kind == 'InstallShield'
                   else ['7zz', 'x', '-y', f'-o{target}', str(path)])
        run(command, logs / f'{digest[:16]}-extract.log')
        files = []
        for child in sorted(target.rglob('*')):
            if child.is_symlink() or not child.resolve().is_relative_to(target.resolve()):
                raise ValueError('Unsafe extracted container member')
            if child.is_file():
                files.append(dict(path=str(child.relative_to(target)), bytes=child.stat().st_size, sha256=sha256(child)))
                queue.append(child)
        containers.append(dict(source=str(path.relative_to(output)), sha256=digest, kind=kind,
                               command=command, output=str(target.relative_to(output)), files=files))
        extracted[digest] = str(target.relative_to(output))
        print(f'{path.name}: {kind}, {len(files)} files', flush=True)
    manifest = dict(schemaVersion=1, containers=containers)
    (output / 'container-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    expand(Path('build/media2'))
