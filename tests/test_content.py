import hashlib
import json
from pathlib import Path
import unittest
from tools.recover_content import lesson,tokens
ROOT=Path(__file__).resolve().parents[1]
class ContentRecovery(unittest.TestCase):
 def test_exact_source_recovery(self):
  data=json.loads((ROOT/'web/public/content/lessons.json').read_text());self.assertEqual(len(data['lessons']),73);self.assertEqual(sum(len(l['steps']) for l in data['lessons']),3313)
  for l in data['lessons']:
   raw=(ROOT/'recovery/content/tutorial'/Path(l['source']).name).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),l['sha256']);self.assertEqual(lesson(raw,Path(l['source']).name),l)
  manifest=json.loads((ROOT/'recovery/content/manifest.json').read_text());self.assertEqual(hashlib.sha256((ROOT/'recovery/content/CLASSICG.PGN').read_bytes()).hexdigest(),manifest['pgn']['sha256'])
 def test_nested_directives_and_bad_input(self):
  t=tokens('Text{Q:Question{W:clip};Yes;Correct.;1}Tail');self.assertEqual(t[1]['name'],'Q');self.assertIn('{W:clip}',t[1]['argument'])
  with self.assertRaises(ValueError):tokens('{Q:Unclosed')
