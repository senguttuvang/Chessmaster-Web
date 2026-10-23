import hashlib
import json
import struct
import unittest
from pathlib import Path
from PIL import Image
from tools.recover import records

ROOT=Path(__file__).resolve().parents[1]
class RecoveryIntegrity(unittest.TestCase):
    def test_original_executable_identity(self):
        metadata=json.loads((ROOT/'engine/original.json').read_text())
        self.assertEqual(hashlib.sha256((ROOT/'vendor/original/THEKING.EXE').read_bytes()).hexdigest(),metadata['sha256'])

    def test_archive_rejects_incomplete_index(self):
        header=b'\0'*4+b'ChessmasterDat01'+struct.pack('<II',1,32)+b'\0'*4
        with self.assertRaises(ValueError):list(records(header))
        with self.assertRaises(ValueError):list(records(b'not an archive'))

    def test_recovered_set_and_personalities(self):
        for color in 'wb':
            for piece in 'prnbqk':
                with Image.open(ROOT/f'web/public/assets/{color}{piece}.png') as image:
                    self.assertEqual(image.size,(45,47));self.assertEqual(image.mode,'RGBA')
                    self.assertEqual(image.getextrema()[3],(0,255))
        profiles=json.loads((ROOT/'web/public/assets/personalities.json').read_text())
        self.assertEqual(len(profiles),156)
        self.assertEqual(len({p['id'] for p in profiles}),156)
        self.assertTrue(any(p['id']=='aaron' for p in profiles))
