"""Original x86 startup oracle. Same host services, no translated game instructions."""
import ctypes
import struct
import sys
from collections import deque
from pathlib import Path
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import *

root = Path(__file__).resolve().parents[1]
library = ctypes.CDLL(str(root / 'build/reference.dylib'))
library.cm_reference_init.argtypes = [ctypes.c_char_p]
library.cm_reference_init.restype = ctypes.c_uint32
library.cm_reference_memory.restype = ctypes.c_void_p
library.cm_reference_import.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)]
library.import_name.argtypes = [ctypes.c_uint32]
library.import_name.restype = ctypes.c_char_p
entry = library.cm_reference_init(str(root / 'vendor/original/THEKING.EXE').encode())
uc = Uc(UC_ARCH_X86, UC_MODE_32)
uc.mem_map_ptr(0, 0x10000000, 7, library.cm_reference_memory())
uc.mem_map(0xF0000000, 0x10000)
uc.mem_write(0xF0000000, b'\x90' * 0x10000)
registers = [UC_X86_REG_EAX,UC_X86_REG_ECX,UC_X86_REG_EDX,UC_X86_REG_EBX,UC_X86_REG_ESP,UC_X86_REG_EBP,UC_X86_REG_ESI,UC_X86_REG_EDI]
uc.reg_write(UC_X86_REG_ESP, 0x2ffffc)
uc.mem_write(0x2ffffc, struct.pack('<I', 0xDEADBEEF))

def descriptor(base, limit, access, flags):
    return struct.pack('<Q',(limit&65535)|((base&0xffffff)<<16)|(access<<40)|(((limit>>16)&15)<<48)|(flags<<52)|(((base>>24)&255)<<56))
gdt=b'\0'*8+descriptor(0,0xfffff,0x9b,0xc)+descriptor(0,0xfffff,0x93,0xc)+descriptor(0,0xfffff,0xfb,0xc)+descriptor(0,0xfffff,0xf3,0xc)+b'\0'*40+descriptor(0x10000,0xfffff,0xf3,0x4)
uc.mem_write(0x1000,gdt);uc.reg_write(UC_X86_REG_GDTR,(0,0x1000,len(gdt)-1,0))
uc.reg_write(UC_X86_REG_CS,8)
uc.reg_write(UC_X86_REG_SS,16)
for reg in [UC_X86_REG_DS,UC_X86_REG_ES]:uc.reg_write(reg,0x23)
uc.reg_write(UC_X86_REG_FS,0x53)
last=deque(maxlen=20)
trace=open(root/'build/original.trace','wb')
count=0

def instruction(machine,address,size,data):
    global count
    trace.write(struct.pack('<9I',address,*(machine.reg_read(r) for r in registers)))
    count+=1
    last.append(hex(address))
    if address>=0xF0000000:
        name=library.import_name(address).decode()
        print('ORACLE',name,file=sys.stderr,flush=True)
        if name.endswith('ExitProcess') or name.endswith('CreateThread') or ('--play' not in sys.argv and (name.endswith('ReadFile') or name.endswith('PeekNamedPipe'))):
            print('ORACLE boundary',list(last),flush=True);machine.emu_stop();return
        values=(ctypes.c_uint32*8)(*(machine.reg_read(r) for r in registers))
        return_address=struct.unpack('<I',machine.mem_read(values[4],4))[0]
        library.cm_reference_import(address,values)
        for reg,value in zip(registers,values):machine.reg_write(reg,value)
        machine.reg_write(UC_X86_REG_EIP,return_address)
uc.hook_add(UC_HOOK_CODE,instruction)
uc.emu_start(entry,0xDEADBEEF,count=2000000)
trace.close()
print('ORACLE final',hex(uc.reg_read(UC_X86_REG_EIP)),flush=True)
