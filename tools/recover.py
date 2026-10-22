"""Read-only recovery of documented CM9000 archives, personalities and PE metadata."""
import argparse
import ctypes
import hashlib
import io
import json
import struct
import subprocess
from pathlib import Path

import pefile
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]


def records(index: bytes):
    if index[4:20] != b"ChessmasterDat01":
        raise ValueError("Unrecognized archive signature")
    count, start = struct.unpack_from("<II", index, 20)
    if start != 32 or len(index) != start + count * 80:
        raise ValueError("Invalid archive index length")
    for pos in range(start, len(index), 80):
        row = index[pos:pos + 80]
        yield (row[:64].split(b"\0")[0].decode("ascii"), row[64:68].decode("ascii"),
               *struct.unpack_from("<III", row, 68))


class Archive:
    def __init__(self, game: Path, stem: str):
        self.data = (game / (stem + ".DAT")).read_bytes()
        self.index = {r[0].lower(): r for r in records((game / (stem + ".IDX")).read_bytes())}
        libpath = ROOT / "build/libblast.dylib"
        libpath.parent.mkdir(exist_ok=True)
        if not libpath.exists():
            subprocess.run(["cc", "-shared", "-fPIC", "-O2", "-Ivendor/blast", "tools/blast_decode.c",
                            "vendor/blast/blast.c", "-o", str(libpath)], cwd=ROOT, check=True)
        self.lib = ctypes.CDLL(str(libpath))
        self.lib.blast_decode.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
        self.lib.blast_decode.restype = ctypes.c_int

    def read(self, name: str):
        _, codec, offset, unpacked, packed = self.index[name.lower()]
        if offset < 32 or offset + packed > len(self.data) or unpacked > 64 * 1024 * 1024:
            raise ValueError(f"Missing or invalid archive payload: {name}")
        source = self.data[offset:offset + packed]
        if codec == "PKZP":
            target = ctypes.create_string_buffer(unpacked)
            size = self.lib.blast_decode(source, len(source), target, unpacked)
            if size != unpacked:
                raise ValueError(f"Decompression failed for {name}: {size}, expected {unpacked}")
            return target.raw
        if packed == unpacked:
            return source
        raise ValueError(f"Unsupported archive codec {codec} for {name}")


def personality(path: Path):
    b = path.read_bytes()
    if len(b) < 0xA16 or not b.startswith(b"Chessmaster"):
        raise ValueError(f"Invalid personality: {path.name}")
    number = lambda offset: struct.unpack_from("<i", b, offset)[0]
    text = lambda start, end: b[start:end].split(b"\0")[0].decode("cp1252", errors="replace").strip()
    offsets = dict(avd=0x40, sop=0x44, rnd=0x48, md=0x50, sel=0x54, cfd=0x58,
                   mycc=0x60, opcc=0x64, mymob=0x68, opmob=0x6C, myks=0x70, opks=0x74,
                   mypp=0x78, oppp=0x7C, mypw=0x80, oppw=0x84, myq=0x88, opq=0x8C,
                   myr=0x90, opr=0x94, myb=0x98, opb=0x9C, myn=0xA0, opn=0xA4, myp=0xA8, opp=0xAC)
    return dict(id=path.stem.lower(), name=path.stem.replace("_", " ").title(), rating=number(0x38),
                book=text(0xC0, 0x1C4), portrait=text(0x1C4, 0x1E2), style=text(0x1E2, 0x246),
                biography=text(0x246, 0x62E), parameters={k: number(v) for k, v in offsets.items()})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("game", type=Path)
    args = parser.parse_args()
    assets = ROOT / "web/public/assets"
    assets.mkdir(parents=True, exist_ok=True)
    faces = Archive(args.game, "FACES")
    sets = Archive(args.game, "CMSETS")
    for key in ["chessmaster.bmp", "aaron.bmp", "josh.bmp", "fischer.bmp", "niko.bmp"]:
        if key not in faces.index:
            continue
        info = PngImagePlugin.PngInfo()
        info.add_text("Source", "Chessmaster 9000 FACES.DAT: " + key)
        Image.open(io.BytesIO(faces.read(key))).save(assets / key.replace(".bmp", ".png"), pnginfo=info)
    profiles = [personality(p) for p in sorted((args.game / "PERSONAL").glob("*.CMP"))]
    (assets / "personalities.json").write_text(json.dumps(profiles, indent=2))
    names = [r[0] for r in sets.index.values() if r[0].lower().startswith("p2")]
    print("2D sets:", names)
    name = "P2_staunton_brownwhite.bmp"
    sprite = Image.open(io.BytesIO(sets.read(name))).convert("RGBA")
    pixels = sprite.load()
    for y in range(sprite.height):
        for x in range(sprite.width):
            r, g, b, _ = pixels[x, y]
            if r > 240 and b > 240 and g < 20:
                pixels[x, y] = (0, 0, 0, 0)
    for row, color in enumerate("wb"):
        for col, piece in enumerate("prnbqk"):
            info = PngImagePlugin.PngInfo()
            info.add_text("Source", f"Chessmaster 9000 CMSETS.DAT: {name}; row {row}, column {col}; magenta color key")
            sprite.crop((1 + col * 46, 1 + row * 48, 46 + col * 46, 48 + row * 48)).save(assets / f"{color}{piece}.png", pnginfo=info)
    image = ROOT / "vendor/original/THEKING.EXE"
    pe = pefile.PE(str(image))
    imports = [{"dll": x.dll.decode(), "functions": [i.name.decode() if i.name else f"#{i.ordinal}" for i in x.imports]} for x in pe.DIRECTORY_ENTRY_IMPORT]
    manifest = dict(executable=image.name, sha256=hashlib.sha256(image.read_bytes()).hexdigest(),
                    identity="The King 3.23 2002May30", compiler="Watcom", imports=imports,
                    source="User-supplied Chessmaster 9000 installation", missingAudio=["TUTORIAL.DAT", "JWAUDIO.DAT", "NLA.DAT"])
    (ROOT / "engine/original.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Recovered", len(profiles), "personalities; engine", manifest["sha256"])


if __name__ == "__main__":
    main()
