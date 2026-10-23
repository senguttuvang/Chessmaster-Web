"""Recover selected original home/learning artwork from PE without executing it."""
import argparse
import hashlib
import json
from pathlib import Path
import pefile
from PIL import PngImagePlugin
from recover import ROOT
from recover_ui import dib_image

def recover(game):
 out=ROOT/'web/public/assets/rooms';out.mkdir(parents=True,exist_ok=True);evidence=ROOT/'recovery/rooms';evidence.mkdir(exist_ok=True)
 selected={'CM256.DLL':{'LOBBY_BACKGROUND_LARGE':'lobby-background'},'GUIRESOU.DLL':{21600:'learn-to-play',21610:'play-a-game',21605:'chess-sets'}};assets=[]
 for dll,names in selected.items():
  raw=(game/dll).read_bytes();pe=pefile.PE(data=raw)
  for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
   if kind.id!=2:continue
   for entry in kind.directory.entries:
    key=str(entry.name) if entry.name else entry.id
    if key not in names:continue
    data=entry.directory.entries[0].data.struct;dib=pe.get_data(data.OffsetToData,data.Size);image=dib_image(dib).convert('RGBA')
    image.putdata([(r,g,b,0 if r>240 and b>240 and g<20 else 255)for r,g,b,a in image.get_flattened_data()])
    info=PngImagePlugin.PngInfo();info.add_text('Source',f'{dll}:RT_BITMAP/{key}')
    target=out/(names[key]+'.png');image.save(target,pnginfo=info)
    assets.append({'module':dll,'moduleSha256':hashlib.sha256(raw).hexdigest(),'resource':str(key),'language':entry.directory.entries[0].id,'sourceSha256':hashlib.sha256(dib).hexdigest(),'output':str(target.relative_to(ROOT)),'outputSha256':hashlib.sha256(target.read_bytes()).hexdigest()})
 if len(assets)!=sum(len(d)for d in selected.values()):raise ValueError('Required room artwork missing')
 (evidence/'art-manifest.json').write_text(json.dumps({'schemaVersion':1,'assets':assets},indent=2)+'\n');print('Recovered',len(assets),'original room artworks')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('game',type=Path);recover(p.parse_args().game)
