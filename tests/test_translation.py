"""Execute generated C for the Watcom instruction patterns found in The King."""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('x86toc', ROOT/'vendor/cricket-recompiler/translator/x86toc.py')
x86 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(x86)

class WatcomTranslation(unittest.TestCase):
    def execute(self, encoded, setup, verify):
        decoder=Cs(CS_ARCH_X86,CS_MODE_32);decoder.detail=True
        translator=x86.FunctionTranslator(SimpleNamespace(),{'entry':0x400000})
        code='\n'.join(translator.insn(i) for i in decoder.disasm(bytes.fromhex(encoded),0x400000))
        source='#include "cpu.h"\n#include <assert.h>\n#include <stdlib.h>\nuint8_t *g_mem;\nint main(void){g_mem=calloc(1,65536);CPU state={0};CPU *c=&state;'+setup+code+verify+'free(g_mem);return 0;}\n'
        with tempfile.TemporaryDirectory(dir=ROOT/'build') as directory:
            file=Path(directory)/'test.c';binary=Path(directory)/'test'
            file.write_text(source)
            subprocess.run(['cc','-std=c11','-I'+str(ROOT/'vendor/cricket-recompiler/runtime'),str(file),'-lm','-o',str(binary)],check=True,capture_output=True)
            subprocess.run([str(binary)],check=True,capture_output=True)

    def test_watcom_f2_movsd_repeats_all_dwords(self):
        self.execute('f2a5','c->esi=128;c->edi=256;c->ecx=7;for(int i=0;i<7;i++)W32(128+4*i,0x10203040+i);',
                     'assert(c->ecx==0 && c->esi==156 && c->edi==284);for(int i=0;i<7;i++)assert(R32(256+4*i)==0x10203040u+i);')

    def test_forward_overlap_has_x86_replication_semantics(self):
        self.execute('f2a5','c->esi=128;c->edi=132;c->ecx=4;W32(128,17);',
                     'for(int i=0;i<5;i++)assert(R32(128+4*i)==17);')

    def test_segment_push_pop_preserves_dword_stack(self):
        self.execute('061f','c->esp=1024;c->seg_es=0x23;',
                     'assert(c->esp==1024 && c->seg_ds==0x23 && R32(1020)==0x23);')

    def test_aam_decimal_conversion(self):
        self.execute('d40a','c->eax=0xabcd0049;',
                     'assert(c->eax==0xabcd0703 && !c->zf && !c->sf);')

    def test_verr_valid_and_null_selector(self):
        self.execute('0f00e20f94c0','c->edx=0x23;', 'assert((c->eax&255)==1);')
        self.execute('0f00e20f94c0','c->edx=0;', 'assert((c->eax&255)==0);')

if __name__=='__main__':unittest.main()
