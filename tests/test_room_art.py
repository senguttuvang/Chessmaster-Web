import hashlib,json,unittest
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
class RoomArtwork(unittest.TestCase):
 def test_exact_art_provenance(self):
  data=json.loads((ROOT/'recovery/rooms/art-manifest.json').read_text());self.assertEqual(len(data['assets']),5)
  for a in data['assets']:
   p=ROOT/a['output'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),a['outputSha256'])
   with Image.open(p)as im:self.assertIn(a['module'],im.info['Source']);self.assertGreater(im.width,50)

 def test_network_pseudocode_provenance(self):
  data=json.loads((ROOT/'recovery/rooms/network-analysis.json').read_text());self.assertEqual(len(data['functions']),14)
  self.assertEqual(hashlib.sha256((ROOT/data['output']).read_bytes()).hexdigest(),data['outputSha256'])
  self.assertIn({'name':'MPG_Connect','address':'0x10004671'},data['functions'])
  self.assertEqual(data['source']['module'],'MPGAME.DLL')
