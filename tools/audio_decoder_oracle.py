"""Differential check of the isolated original ADPC transform, without Windows APIs.

Unicorn runs only DatFile.dll's pure 0x1495 transform over explicit buffers/tables.
It does not load an application/installer or emulate Windows. All imports are absent;
leaving the selected function or exceeding its bounded instruction budget fails.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP

from media2_codecs import decode_adpc, INDEX, STEPS
from media2_disc import sha256
from recover import records


def original_decode(module, raw):
    pe = pefile.PE(str(module))
    base = pe.OPTIONAL_HEADER.ImageBase
    if base != 0x10000000:
        raise ValueError('Unexpected DatFile.dll base')
    if struct.unpack('<16i', pe.get_data(0x8030, 64)) != INDEX or struct.unpack('<89i', pe.get_data(0x8070, 356)) != STEPS:
        raise ValueError('Original ADPC tables differ')
    uc = Uc(UC_ARCH_X86, UC_MODE_32)
    image = pe.get_memory_mapped_image()
    uc.mem_map(base, (len(image) + 4095) & ~4095)
    uc.mem_write(base, image)
    pe.close()
    start, end = 0x10001495, 0x10001620
    source, target, state, stack, sentinel = 0x20000000, 0x21000000, 0x22000000, 0x23000000, 0x24000000
    for address, length in [(source, len(raw)), (target, len(raw) * 4), (state, 8), (stack, 65536), (sentinel, 1)]:
        uc.mem_map(address, (length + 4095) & ~4095)
    uc.mem_write(source, raw)
    sp = stack + 65536 - 20
    uc.mem_write(sp, struct.pack('<5I', sentinel, source, target, len(raw) * 2, state))
    uc.reg_write(UC_X86_REG_ESP, sp)
    # Instruction hooks constrain control flow as well as bounding execution time.
    from unicorn import UC_HOOK_CODE
    def check_pc(machine, address, size, user):
        if not start <= address < end:
            raise ValueError(f'ADPC oracle left selected transform at {address:x}')
    uc.hook_add(UC_HOOK_CODE, check_pc)
    uc.emu_start(start, sentinel, count=max(1000, len(raw) * 160))
    if uc.reg_read(UC_X86_REG_EIP) != sentinel:
        raise ValueError('ADPC oracle instruction budget exhausted')
    return bytes(uc.mem_read(target, len(raw) * 4))


def verify(output):
    output = Path(output)
    module = output / 'install/program/DatFile.dll'
    idx, dat = output / 'install/program/CMSets.idx', output / 'install/dat_cmsets/CMSets.dat'
    checks = []
    with dat.open('rb') as stream:
        for name, codec, offset, declared, size in records(idx.read_bytes()):
            if codec != 'ADPC':
                continue
            stream.seek(offset)
            raw = stream.read(size)
            expected = original_decode(module, raw)
            actual = decode_adpc(raw)
            if actual != expected:
                raise ValueError(f'Original/reconstructed ADPC mismatch: {name}')
            checks.append(dict(name=name, sourceSha256=hashlib.sha256(raw).hexdigest(),
                               pcmSha256=hashlib.sha256(actual).hexdigest(), samples=len(actual) // 2,
                               missingDeclaredSamples=(declared - len(actual)) // 2))
            print(f'Original ADPC parity: {len(checks)} {name}', flush=True)
    evidence = dict(schemaVersion=1, moduleSha256=sha256(module), function='0x10001495',
                    scope='Pure x86 transform under Unicorn; no Windows, imports or GUI; bounded encoded samples only',
                    checks=checks)
    path = output / 'adpc-oracle.json'
    path.write_text(json.dumps(evidence, indent=2) + '\n')
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('build/media2'))
    verify(parser.parse_args().output)
