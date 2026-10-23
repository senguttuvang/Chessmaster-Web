import hashlib
import json
import struct
import unittest
from pathlib import Path
from PIL import Image
from tools.win32_resources import menu, dialog

ROOT=Path(__file__).resolve().parents[1]

class UIRecovery(unittest.TestCase):
    def test_provenance_and_no_engine_mutation(self):
        manifest=json.loads((ROOT/'recovery/ui/manifest.json').read_text())
        self.assertGreater(len(manifest['assets']),250)
        outputs=set()
        for asset in manifest['assets']:
            path=ROOT/asset['output']
            self.assertNotIn(asset['output'],outputs);outputs.add(asset['output'])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),asset['outputSha256'],asset['output'])
        self.assertEqual(hashlib.sha256((ROOT/'vendor/original/THEKING.EXE').read_bytes()).hexdigest(),'9bd6c1b16251e3a462c61c63b4811605a6072fbeb2311ebe7c05842dd0bfc236')

    def test_templates_match_raw_resources(self):
        resources=json.loads((ROOT/'recovery/ui/pe-resources.json').read_text())
        menus=[];dialogs=[]
        for dll, data in resources.items():
            for entry in data['resources']:
                if entry['type'] not in [4,5]:continue
                raw=(ROOT/f"recovery/ui/{dll}-{entry['type']}-{entry['name']}-{entry['language']}.bin").read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['sha256'])
                if entry['type']==4:
                    self.assertEqual(menu(raw),entry['menu']);menus.append(entry)
                else:
                    self.assertEqual(dialog(raw),entry['dialog']);dialogs.append(entry)
        self.assertEqual(len(menus),13)
        self.assertEqual(len(dialogs),143)
        game=next(m for m in menus if m['name']=='20')['menu']['items']
        self.assertEqual([i['text'] for i in game],['&File','&Edit','&Game','&Actions','&Preferences','&Windows','&Rooms','&Help'])

    def test_converted_original_geometry(self):
        for name in ['Staunton_'+p for p in 'KQBNRP']+['planar_surface','planar_frame']:
            path=ROOT/f'web/public/assets/recovered/{name}.gltf'
            data=json.loads(path.read_text())
            self.assertEqual(data['asset']['version'],'2.0')
            self.assertTrue(data['meshes'])
            for buffer in data['buffers']:
                binary=(path.parent/buffer['uri']).read_bytes()
                self.assertGreaterEqual(len(binary),buffer['byteLength'])
            positions=data['accessors'][0]
            self.assertEqual(positions['type'],'VEC3')
            self.assertGreater(positions['count'],0)
            if name=='Staunton_K':
                self.assertEqual(positions['count'],911)
                self.assertAlmostEqual(positions['max'][2],1.746306,places=5)
            self.assertNotIn('images',data) # runtime uses the INI-selected texture
        for name in ['wood','gold','game','classroom','StauntonWood01W','BoardWoodDark512','decal-a']:
            with Image.open(ROOT/f'web/public/assets/recovered/{name}.png') as im:
                self.assertIn('Source',im.info)
                self.assertEqual(len(im.info['SourceSHA256']),64)

    def test_corrupt_templates_fail(self):
        with self.assertRaises(struct.error):menu(b'\x00')
        with self.assertRaises(struct.error):dialog(b'\x00')
