"""Normalize only PE section metadata for Ghidra; original executable stays unchanged."""
import struct
from pathlib import Path
import pefile

source = Path("vendor/original/THEKING.EXE")
pe = pefile.PE(str(source))
image = bytearray(source.read_bytes())
for section in pe.sections:
    offset = section.get_file_offset()
    if section.Misc_VirtualSize == 0:
        struct.pack_into("<I", image, offset + 8, section.SizeOfRawData)
    if section.PointerToRawData == 0:
        struct.pack_into("<I", image, offset + 16, 0)
target = Path("build/THEKING.analysis.exe")
target.parent.mkdir(exist_ok=True)
target.write_bytes(image)
