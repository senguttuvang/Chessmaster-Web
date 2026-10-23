"""Check original lesson media references against top-level files and archive metadata only."""
import argparse
import json
from pathlib import Path
from recover import records,ROOT

def audit(game):
 data=json.loads((ROOT/'web/public/content/lessons.json').read_text());refs={t['argument'] for l in data['lessons'] for s in l['steps'] for t in s['tokens'] if t.get('name')=='L' and t['argument']!='0'}
 archives=[]
 for idx in sorted(game.glob('*.IDX')):
  raw=idx.read_bytes()
  if raw[4:20]!=b'ChessmasterDat01':continue
  dat=idx.with_suffix('.DAT');size=dat.stat().st_size if dat.exists() else 0
  archives.append((idx.name,size,list(records(raw))))
 files={p.name.lower():p for p in game.iterdir() if p.is_file()}
 result=[]
 for ref in sorted(refs):
  matches=[]
  for index,size,rows in archives:
   for name,codec,offset,unpacked,packed in rows:
    if name.lower()==ref.lower():matches.append({'archive':index.replace('.IDX','.DAT'),'entry':name,'payloadAvailable':offset>=32 and packed>0 and offset+packed<=size})
  result.append({'reference':ref,'topLevelFile':ref.lower() in files,'archiveMatches':matches})
 out={'schemaVersion':1,'scope':'Top-level files and original archive indices; excludes USERS; no media inference from index alone','images':result}
 (ROOT/'recovery/content/media-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('game',type=Path);audit(p.parse_args().game)
