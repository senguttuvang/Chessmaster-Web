"""Static UI preservation: PE resources and selected original 3D/rail artwork.

Pillow is used for DIB/DDS decoding; pefile reads PE resources without executing them.
All installation access is read-only. Full bitmap previews are build evidence, not runtime.
"""
import argparse
import hashlib
import io
import json
import struct
import subprocess
from pathlib import Path

import pefile
from PIL import Image, ImageDraw, PngImagePlugin
from recover import Archive, ROOT
from win32_resources import menu, dialog


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dib_image(data):
    header, = struct.unpack_from('<I', data)
    bits, = struct.unpack_from('<H', data, 14)
    colors, = struct.unpack_from('<I', data, 32)
    palette = (colors or (1 << bits)) * 4 if bits <= 8 else 0
    compression, = struct.unpack_from('<I', data, 16)
    masks = 12 if header == 40 and compression == 3 else 0
    return Image.open(io.BytesIO(b'BM' + struct.pack('<IHHI', len(data)+14, 0, 0, 14+header+palette+masks) + data))


def contact_sheet(items, path, columns=8):
    sheet = Image.new('RGB', (columns*160, ((len(items)+columns-1)//columns)*118), '#d5cfb7')
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(items):
        im = im.convert('RGBA'); im.thumbnail((152, 90))
        x, y = (i % columns)*160, (i//columns)*118
        sheet.paste(im, (x+(160-im.width)//2, y), im)
        draw.text((x+3,y+92), name[:26], fill='black')
    sheet.save(path)


def recover(game):
    out = ROOT/'web/public/assets/recovered'
    evidence = ROOT/'build/ui-recovery'
    source = ROOT/'recovery/ui'
    for p in [out, evidence, source, source/'models', source/'config']:
        p.mkdir(parents=True, exist_ok=True)
    manifest = {'sources': {}, 'assets': [], 'limits': 'Static resources only; runtime UI behavior and screenshot material identity unverified.'}
    def record(src, raw, target, **meta):
        manifest['assets'].append(dict(source=src, sourceSha256=sha(raw), output=str(target.relative_to(ROOT)), outputSha256=sha(target.read_bytes()), **meta))
    def png(src, raw, im, target):
        info = PngImagePlugin.PngInfo(); info.add_text('Source', src); info.add_text('SourceSHA256', sha(raw))
        im.save(target, pnginfo=info); record(src,raw,target)
    resources = {}
    previews = []
    for dll in ['CHESSMAS.EXE','GUIRESOU.DLL','CUSTOMGU.DLL','CM256.DLL']:
        data = (game/dll).read_bytes(); manifest['sources'][dll] = sha(data)
        pe = pefile.PE(data=data)
        entries = []
        for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            for name in kind.directory.entries:
                for lang in name.directory.entries:
                    d = lang.data.struct
                    raw = pe.get_data(d.OffsetToData,d.Size)
                    item = dict(type=kind.id, typeName=str(kind.name) if kind.name else None, name=str(name.name or name.id), language=lang.id, size=len(raw), sha256=sha(raw))
                    if kind.id == 6:
                        strings=[]; pos=0
                        for i in range(16):
                            n,=struct.unpack_from('<H',raw,pos); pos+=2
                            text=raw[pos:pos+2*n].decode('utf-16le'); pos+=2*n
                            if text: strings.append(dict(id=(name.id-1)*16+i,text=text))
                        item['strings']=strings
                    elif kind.id in [4,5,9]:
                        # Preserve exact resource templates and readable UTF-16 spans for audit.
                        target=source/f'{dll}-{kind.id}-{name.name or name.id}-{lang.id}.bin'
                        target.write_bytes(raw); record(f'{dll}:RT_{kind.id}/{name.id}/{lang.id}',raw,target)
                        import re
                        item['text']=[s.decode('utf-16le') for s in re.findall(rb'(?:[\x20-\x7e]\x00){2,}',raw)]
                        if kind.id == 4: item['menu']=menu(raw)
                        elif kind.id == 5: item['dialog']=dialog(raw)
                    elif kind.id == 2:
                        im=dib_image(raw).convert('RGB')
                        item['dimensions']=list(im.size)
                        target=evidence/f'{dll}-{name.name or name.id}.png'; im.save(target)
                        selected = {'GUIRESOU.DLL': {21550:'kids',21555:'classroom',21560:'database',21565:'game',21570:'library',21575:'live',21580:'tournament',21595:'lobby',21655:'new-game',21680:'rated',21685:'tourney',30163:'window-icon',30158:'close',30157:'minimize',30299:'wordmark',30335:'wood',30143:'gold',30380:'white-king',30384:'black-king',20005:'first',20000:'last',20010:'next',20020:'previous',21740:'true3d',21750:'flat2d'}, 'CM256.DLL': {'NAVBAR':'rail-wood'}}
                        alias = selected.get(dll,{}).get(str(name.name) if name.name else name.id)
                        if alias:
                            image=im.convert('RGBA')
                            image.putdata([(r,g,b,0 if r>240 and b>240 and g<20 else 255) for r,g,b,_ in image.get_flattened_data()])
                            png(f'{dll}:RT_BITMAP/{name.name or name.id}/{lang.id}',raw,image,out/f'{alias}.png')
                        previews.append((f'{dll[:3]}-{name.id} {im.width}x{im.height}',im.copy()))
                    entries.append(item)
        resources[dll] = dict(resources=entries, imports={d.dll.decode():[i.name.decode() if i.name else f'#{i.ordinal}' for i in d.imports] for d in getattr(pe,'DIRECTORY_ENTRY_IMPORT',[])}, exports=[dict(name=e.name.decode() if e.name else None, rva=e.address) for e in getattr(getattr(pe,'DIRECTORY_ENTRY_EXPORT',None),'symbols',[])])
    (source/'pe-resources.json').write_text(json.dumps(resources,indent=2)+'\n')
    for i in range(0,len(previews),96): contact_sheet(previews[i:i+96],evidence/f'pe-sheet-{i//96}.png')
    anim=Archive(game,'ANIM'); sets=Archive(game,'CMSETS')
    for stem, arc in [('ANIM',anim),('CMSETS',sets)]:
        manifest['sources'][stem+'.DAT']=sha(arc.data)
        (source/f'{stem.lower()}-catalog.json').write_text(json.dumps([dict(name=r[0],codec=r[1],offset=r[2],unpacked=r[3],packed=r[4]) for r in arc.index.values()],indent=2)+'\n')
    previews=[]
    for r in sets.index.values():
        name=r[0]
        if name.lower().endswith(('.ini','.lights')):
            raw=sets.read(name); target=source/'config'/name; target.write_bytes(raw); record(f'CMSETS.DAT:{name}',raw,target)
        if name.lower().endswith('_p.bmp'):
            im=Image.open(io.BytesIO(sets.read(name))); previews.append((name,im.copy()))
    contact_sheet(previews,evidence/'sets.png')
    names=[f'Staunton_{p}.X' for p in 'KQBNRP']+['planar_surface.x','planar_frame.x']
    for name in names:
        raw=sets.read(name); target=source/'models'/name; target.write_bytes(raw); record(f'CMSETS.DAT:{name}',raw,target)
    for name in ['StauntonWoodW.dds','StauntonWoodB.dds','StauntonWood01W.dds','StauntonWood01B.dds','StauntonWood02W.dds','StauntonWood02B.dds','BoardWoodDark512.dds','BoardWoodBurl512.dds','BoardWoodMahogany512.dds','Decals_Brown.dds']:
        if name.lower() not in sets.index: continue
        raw=sets.read(name); png(f'CMSETS.DAT:{name}',raw,Image.open(io.BytesIO(raw)),out/(Path(name).stem+'.png'))
    conversion=[]
    for name in names:
        original=source/'models'/name
        target=out/(Path(name).stem+'.gltf')
        subprocess.run(['assimp','export',str(original),str(target),'-fgltf2'],check=True,stdout=subprocess.DEVNULL)
        gltf=json.loads(target.read_text())
        # Runtime assigns the configuration-selected PNG textures. Embedded .X
        # materials refer to other sets and unavailable authoring-time files.
        gltf.pop('images',None); gltf.pop('textures',None); gltf.pop('samplers',None)
        gltf['materials']=[{'name':'configuration-selected-original-texture'} for _ in gltf.get('materials',[])]
        target.write_text(json.dumps(gltf,separators=(',',':'))+'\n')
        record(f'CMSETS.DAT:{name} via Assimp gltf2; materials assigned from INI',original.read_bytes(),target)
        binary=target.with_suffix('.bin');record(f'CMSETS.DAT:{name} via Assimp gltf2',original.read_bytes(),binary)
    raw=sets.read('Decals_Brown.dds')
    atlas=Image.open(io.BytesIO(raw)).convert('RGBA')
    # Atlas cells recovered from the eight numbered/file-label pairs.
    for i in range(8):
        for text, box, rotation in [(str(8-i),(16,i*64+16,48,i*64+48),0),('abcdefgh'[i],(64,i*64+16,96,i*64+48),90)]:
            im=atlas.crop(box).rotate(rotation)
            png(f'CMSETS.DAT:Decals_Brown.dds; cell {box}; rotate {rotation}',raw,im,out/f'decal-{text}.png')
    manifest['conversion']=subprocess.check_output(['assimp','version'],text=True).strip()
    raw=(game/'CM9000.TTF').read_bytes(); target=out/'CM9000.ttf';target.write_bytes(raw);record('CM9000.TTF',raw,target)
    (source/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Recovered',len(manifest['assets']),'assets; evidence:',evidence)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('game',type=Path)
    recover(parser.parse_args().game)
