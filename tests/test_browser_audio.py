"""Own-media staging boundaries; synthetic wave bytes are unit-test fixtures only."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import prepare_browser_audio as staging
from media2_codecs import pcm_wave


class BrowserAudioStaging(unittest.TestCase):
    def fixture(self, root):
        catalogue = root / 'catalogue'
        catalogue.mkdir()
        source = pcm_wave(bytes(16), 22050)
        (catalogue / 'tiny.wav').write_bytes(source)
        digest = hashlib.sha256(source).hexdigest()
        clips = [dict(id=id, group=id.split(':')[0], playable='tiny.wav', playableSha256=digest,
                      metadata=dict(duration=8 / 22050)) for id in staging.EVENTS.values()]
        manifest = dict(errors=[], decodeValidation=[dict(fixture=True)], clips=clips, illustrations=[])
        (catalogue / 'manifest.json').write_text(json.dumps(manifest))
        return catalogue, manifest

    def test_exact_hashes_urls_events_and_ignored_payload_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); catalogue, manifest = self.fixture(root)
            with patch.object(staging, 'ROOT', root):
                staging.stage(catalogue)
            index = json.loads((root / 'web/public/audio/index.json').read_text())
            self.assertEqual(index['events'], staging.EVENTS)
            for clip in index['clips'].values():
                self.assertTrue(clip['url'].startswith('/audio/clips/'))
                self.assertEqual((root / 'web/public' / clip['url'].lstrip('/')).read_bytes(), (catalogue / 'tiny.wav').read_bytes())

    def test_unsafe_identity_changed_bytes_and_failed_recovery_fail_loud(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); catalogue, manifest = self.fixture(root)
            with patch.object(staging, 'ROOT', root):
                for mutate in (
                    lambda m: m['clips'][0].update(group='../escape'),
                    lambda m: m['clips'][0].update(playable='../outside.wav'),
                    lambda m: m['clips'][0].update(playableSha256='invalid'),
                    lambda m: m.update(errors=[dict(error='source failure')]),
                ):
                    bad = json.loads(json.dumps(manifest)); mutate(bad)
                    (catalogue / 'manifest.json').write_text(json.dumps(bad))
                    with self.assertRaises(ValueError):
                        staging.stage(catalogue)
