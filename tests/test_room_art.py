import hashlib,json,unittest
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
class RoomArtwork(unittest.TestCase):
 def test_exact_art_provenance(self):
  data=json.loads((ROOT/'recovery/rooms/art-manifest.json').read_text());self.assertEqual(len(data['assets']),4)
  for a in data['assets']:
   p=ROOT/a['output'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),a['outputSha256'])
   with Image.open(p)as im:self.assertIn(a['module'],im.info['Source']);self.assertGreater(im.width,50)
