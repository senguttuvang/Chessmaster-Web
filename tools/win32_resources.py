"""Decode standard Win32 menu/dialog templates; preserves IDs, styles and coordinates."""
import struct

class Reader:
    def __init__(self, raw): self.raw=raw; self.pos=0
    def word(self):
        n,=struct.unpack_from('<H',self.raw,self.pos);self.pos+=2;return n
    def dword(self):
        n,=struct.unpack_from('<I',self.raw,self.pos);self.pos+=4;return n
    def align(self): self.pos=(self.pos+3)&~3
    def text(self, first=None):
        chars=[];n=self.word() if first is None else first
        while n: chars.append(n);n=self.word()
        return struct.pack('<'+'H'*len(chars),*chars).decode('utf-16le')
    def field(self):
        n=self.word()
        return {'ordinal':self.word()} if n==65535 else self.text(n)
    def rect(self): return [struct.unpack('<h',struct.pack('<H',self.word()))[0] for _ in range(4)]


def menu(raw):
    r=Reader(raw);version=r.word();offset=r.word()
    if version!=0: return {'version':version,'unsupported':'extended menu; raw retained'}
    r.pos=4+offset
    def items():
        result=[]
        while True:
            flags=r.word();item={'flags':flags}
            if not flags&16: item['id']=r.word()
            item['text']=r.text()
            if flags&16: item['children']=items()
            result.append(item)
            if flags&128: return result
    return {'version':version,'items':items()}


def dialog(raw):
    r=Reader(raw);extended=raw[:4]==b'\x01\x00\xff\xff'
    if extended:
        r.pos=4;help_id=r.dword();exstyle=r.dword();style=r.dword()
    else: style=r.dword();exstyle=r.dword();help_id=None
    count=r.word();rect=r.rect()
    result=dict(extended=extended,style=style,exstyle=exstyle,helpId=help_id,rect=rect,menu=r.field(),windowClass=r.field(),title=r.field())
    if style&64:
        font={'pointSize':r.word()}
        if extended:
            font['weight']=r.word();font['italic']=r.raw[r.pos];font['charset']=r.raw[r.pos+1];r.pos+=2
        font['face']=r.text();result['font']=font
    controls=[]
    for _ in range(count):
        r.align()
        if extended: h=r.dword();ex=r.dword();s=r.dword()
        else: s=r.dword();ex=r.dword();h=None
        rect=r.rect();cid=r.dword() if extended else r.word()
        c=dict(id=cid,style=s,exstyle=ex,helpId=h,rect=rect,windowClass=r.field(),text=r.field())
        size=r.word()
        if size: c['creationData']=r.raw[r.pos:r.pos+size].hex();r.pos+=size
        controls.append(c)
    result['controls']=controls;return result
