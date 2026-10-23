"""Read-only, reproducible PE/resource/archive inventory of a supplied installation.

Run with the pinned Python environment. JSON uses relative filenames and excludes
USERS profiles. Optional payload samples prove that indexed assets can be decoded.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import pefile

if __package__:
    from .recover import Archive, records
else:
    from recover import Archive, records


def pe_inventory(path: Path):
    pe = pefile.PE(str(path))
    try:
        resources = {}
        for entry in getattr(getattr(pe, "DIRECTORY_ENTRY_RESOURCE", None), "entries", []):
            name = str(entry.name) if entry.name else pefile.RESOURCE_TYPE.get(entry.id, str(entry.id))
            resources[name] = len(entry.directory.entries)
        imports = [{"dll": row.dll.decode("ascii", errors="replace"), "functions": len(row.imports)}
                   for row in getattr(pe, "DIRECTORY_ENTRY_IMPORT", [])]
        exports = [row.name.decode("ascii", errors="replace")
                   for row in getattr(getattr(pe, "DIRECTORY_ENTRY_EXPORT", None), "symbols", [])
                   if row.name]
        return {"file": path.name, "size": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "machine": hex(pe.FILE_HEADER.Machine), "resources": resources,
                "imports": imports, "exports": exports}
    finally:
        pe.close()


def archive_inventory(game: Path, stem: str, sample: bool):
    rows = list(records((game / (stem + ".IDX")).read_bytes()))
    result = {"file": stem + ".DAT", "entries": len(rows),
              "extensions": dict(sorted(Counter(Path(row[0]).suffix.lower() for row in rows).items())),
              "names": [row[0] for row in rows]}
    if sample:
        archive = Archive(game, stem)
        samples = []
        for extension in (".x", ".dds", ".ini", ".lights"):
            name = next((row[0] for row in rows if row[0].lower().endswith(extension)), None)
            if name:
                data = archive.read(name)
                samples.append({"name": name, "decodedBytes": len(data),
                                "sha256": hashlib.sha256(data).hexdigest(),
                                "headerHex": data[:16].hex()})
        result["decodedSamples"] = samples
    return result


def inspect(game: Path, sample=False):
    if not game.is_dir():
        raise ValueError("Installation directory does not exist")
    modules = [game / name for name in ("CHESSMAS.EXE", "GUIRESOU.DLL", "CUSTOMGU.DLL",
                                        "DISPLAY8.DLL", "ANIM8.DLL", "CM256.DLL", "THEKING.EXE")]
    missing = [path.name for path in modules if not path.is_file()]
    if missing:
        raise ValueError("Missing required inspection modules: " + ", ".join(missing))
    return {"scope": "Top-level application modules and selected archives; user profiles excluded",
            "resourceCountUnit": "Resource name/id entries per type, not language variants",
            "modules": [pe_inventory(path) for path in modules],
            "archives": [archive_inventory(game, stem, sample) for stem in ("CMSETS", "ANIM", "ABOUT")]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game", type=Path)
    parser.add_argument("--sample-payloads", action="store_true",
                        help="Decode representative assets; may compile the local blast helper")
    parser.add_argument("--output", type=Path, help="Write JSON instead of standard output")
    args = parser.parse_args()
    result = json.dumps(inspect(args.game, args.sample_payloads), indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
