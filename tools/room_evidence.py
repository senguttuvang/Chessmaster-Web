"""Bounded static room evidence: PE strings/addresses and exact resource IDs. Never executes modules."""
import argparse,hashlib,json,re
from pathlib import Path
import pefile
from recover import ROOT

ROOMS={'database':r'database|\.pgn|import game|export game|search game','tournament':r'tournament|round.robin|swiss|standings|pairing|rounds','live':r'cmlive|chessmasterlive|ubi\.com|login|logon|socket|server|internet|connect|password'}

def recover(game):
 out=ROOT/'recovery/rooms';out.mkdir(exist_ok=True)
 resources=json.loads((ROOT/'recovery/ui/pe-resources.json').read_text())
 sources=[];strings=[]
 for name in ['CHESSMAS.EXE','CUSTOMGU.DLL','DATABASE.DLL','MPGAME.DLL','MPCCEXT.DLL','TBGAME.DLL','TBKEY.DLL']:
  path=game/name;raw=path.read_bytes();pe=pefile.PE(data=raw)
  sources.append({'module':name,'sha256':hashlib.sha256(raw).hexdigest(),'imageBase':hex(pe.OPTIONAL_HEADER.ImageBase),'imports':{d.dll.decode():[i.name.decode()if i.name else f'#{i.ordinal}'for i in d.imports]for d in getattr(pe,'DIRECTORY_ENTRY_IMPORT',[])}})
  for m in re.finditer(rb'[\x20-\x7e]{4,512}',raw):
   text=m[0].decode('ascii');rooms=[room for room,pattern in ROOMS.items()if re.search(pattern,text,re.I)]
   if not rooms:continue
   try:rva=pe.get_rva_from_offset(m.start())
   except pefile.PEFormatError:rva=None
   strings.append({'module':name,'fileOffset':hex(m.start()),'rva':hex(rva)if rva is not None else None,'address':hex(pe.OPTIONAL_HEADER.ImageBase+rva)if rva is not None else None,'rooms':rooms,'text':text})
 selected=[]
 for dll,data in resources.items():
  for entry in data['resources']:
   if entry['type'] not in [4,5,6]:continue
   encoded=json.dumps(entry)
   rooms=[room for room,pattern in ROOMS.items()if re.search(pattern,encoded,re.I)]
   if rooms:selected.append({'module':dll,'rooms':rooms,'resource':entry})
 result={'schemaVersion':1,'method':'Read-only PE ASCII strings and decoded resource filter; string addresses are references for investigation, not proof of event/protocol behavior. No endpoints contacted.','sources':sources,'strings':strings,'resources':selected}
 (out/'static-room-evidence.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'modules':len(sources),'matchedStrings':len(strings),'matchedResources':len(selected)}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('game',type=Path);recover(p.parse_args().game)
