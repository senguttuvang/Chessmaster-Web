"""Read-only plaintext lesson/game recovery. Nested directives are preserved, not executed."""
import argparse
from collections import Counter
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def tokens(text):
    result=[];start=0;i=0
    while i<len(text):
        if text[i]!='{':i+=1;continue
        if i>start:result.append({'kind':'text','text':text[start:i]})
        depth=1;j=i+1
        while j<len(text) and depth:
            if text[j]=='{':depth+=1
            elif text[j]=='}':depth-=1
            j+=1
        if depth:raise ValueError('Unclosed lesson directive')
        raw=text[i:j];body=raw[1:-1];name,sep,arg=body.partition(':')
        result.append({'kind':'command','name':name,'argument':arg if sep else '', 'raw':raw})
        i=j;start=j
    if start<len(text):result.append({'kind':'text','text':text[start:]})
    return result


def lesson(raw, name):
    text=raw.decode('cp1252').replace('\r\n','\n')
    matches=list(re.finditer(r'(?m)^\s*(\d+)\.\s*\n(?:@[^\n]*\n)?\[',text))
    if not matches:raise ValueError(f'No numbered lesson steps: {name}')
    steps=[]
    for i,m in enumerate(matches):
        block=text[m.end():matches[i+1].start() if i+1<len(matches) else len(text)].strip()
        if ']' not in block:raise ValueError(f'Unclosed step: {name}/{m[1]}')
        body=block[:block.rfind(']')]
        steps.append({'number':int(m[1]),'tokens':tokens(body),'raw':body,'trailingText':block[block.rfind(']')+1:].strip()})
    return {'id':Path(name).stem.lower(),'title':text[:matches[0].start()].strip(),'source':f'TUTORIAL/{name}','sha256':hashlib.sha256(raw).hexdigest(),'steps':steps}


def recover(game):
    out=ROOT/'web/public/content';rawdir=ROOT/'recovery/content';out.mkdir(parents=True,exist_ok=True);(rawdir/'tutorial').mkdir(parents=True,exist_ok=True)
    lessons=[];counts=Counter();exercise=Counter()
    for path in sorted((game/'TUTORIAL').glob('*.TUT')):
        raw=path.read_bytes();item=lesson(raw,path.name);lessons.append(item);(rawdir/'tutorial'/path.name).write_bytes(raw)
        for step in item['steps']:
            for t in step['tokens']:
                if t['kind']=='command':
                    counts[t['name']]+=1
                    if t['name'] in ['E','V','Q']:exercise[t['name']]+=1
    (out/'lessons.json').write_text(json.dumps({'schemaVersion':1,'lessons':lessons},indent=2)+'\n')
    pgn=(game/'CLASSICG.PGN').read_bytes();(rawdir/'CLASSICG.PGN').write_bytes(pgn);(out/'classic.pgn').write_bytes(pgn)
    manifest={'schemaVersion':1,'encoding':'Windows-1252','lessons':[{'id':l['id'],'title':l['title'],'source':l['source'],'sha256':l['sha256'],'steps':len(l['steps'])} for l in lessons],'pgn':{'source':'CLASSICG.PGN','sha256':hashlib.sha256(pgn).hexdigest(),'bytes':len(pgn)},'directives':dict(counts),'exercises':dict(exercise),'narration':'References retained; supplied narration archives are placeholders, no audio restored.'}
    (rawdir/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'lessons':len(lessons),'steps':sum(len(l['steps']) for l in lessons),'directives':counts,'exercises':exercise},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('game',type=Path);recover(parser.parse_args().game)
