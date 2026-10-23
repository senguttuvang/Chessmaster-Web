"""Recovery boundaries and observed codec contracts; no external discs required."""
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import wave
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from media2_codecs import adpc_audio, decode_adpc, mp3_header, mp3_metadata, pcm_wave, wav_metadata
from media2_disc import Disc, sha256, verify_zips
from recover_audio import checked_records, concat_file, signature, verify_reuse


def chunk(tag, raw):
    return tag + struct.pack('<I', len(raw)) + raw + b'\0' * (len(raw) % 2)


def riff(*chunks):
    body = b'WAVE' + b''.join(chunks)
    return b'RIFF' + struct.pack('<I', len(body)) + body


def index(rows):
    header = b'\x20\0\0\0ChessmasterDat01' + struct.pack('<III', len(rows), 32, 0)
    return header + b''.join(name.encode().ljust(64, b'\0') + codec.encode() + struct.pack('<III', offset, unpacked, packed)
                             for name, codec, offset, unpacked, packed in rows)


class AudioCodecTests(unittest.TestCase):
    def test_adpc_original_x86_golden_and_state(self):
        # Expected bytes from DatFile.dll 0x10001495 under bounded Unicorn.
        source = bytes.fromhex('7080ff1234567890')
        expected = bytes.fromhex('0b000d000c000d00f7ffc9ffdcfffbff21004f0093000901fc01da017c019801')
        self.assertEqual(decode_adpc(source), expected)
        self.assertNotEqual(decode_adpc(source[:4]) + decode_adpc(source[4:]), expected)
        self.assertEqual(len(decode_adpc(bytes(range(256)))), 1024)
        with self.assertRaisesRegex(ValueError, 'Empty'):
            decode_adpc(b'')

    def test_adpc_export_view_excludes_reconstructed_header(self):
        source = bytes(range(30))
        decoded, playable, metadata = adpc_audio(source, 122)
        with wave.open(io.BytesIO(playable), 'rb') as stream:
            self.assertEqual(stream.readframes(1000), decoded[44:])
            self.assertEqual(stream.getnframes(), 38)
        self.assertEqual(metadata['missingDeclaredSamples'], 1)
        self.assertEqual(metadata['decodedSamples'], 60)
        for declared in (120 - 2, 124):
            with self.assertRaises(ValueError):
                adpc_audio(source, declared)

    def test_pcm_header_and_exact_samples(self):
        pcm = struct.pack('<5h', -32768, -1, 0, 1, 32767)
        raw = pcm_wave(pcm, 22050)
        self.assertEqual(wav_metadata(raw)['samples'], 5)
        with wave.open(io.BytesIO(raw), 'rb') as stream:
            self.assertEqual(stream.getparams()[:4], (1, 2, 22050, 5))
            self.assertEqual(stream.readframes(5), pcm)
        with self.assertRaises(ValueError):
            pcm_wave(b'\0', 22050)
        with self.assertRaises(ValueError):
            pcm_wave(pcm, 0)

    def test_ima_wav_partial_block_and_fact_padding(self):
        fmt = struct.pack('<HHIIHHHH', 17, 1, 22050, 11025, 8, 4, 2, 9)
        data = b'\0' * 13  # One full block, one partial block, each with predictor header.
        raw = riff(chunk(b'fmt ', fmt), chunk(b'fact', struct.pack('<I', 10)), chunk(b'data', data))
        metadata = wav_metadata(raw)
        self.assertEqual((metadata['samples'], metadata['encodedSamples'], metadata['paddingSamples']), (10, 12, 2))
        invalid = bytearray(data); invalid[2] = 89
        with self.assertRaisesRegex(ValueError, 'predictor'):
            wav_metadata(riff(chunk(b'fmt ', fmt), chunk(b'data', invalid)))
        with self.assertRaisesRegex(ValueError, 'fact'):
            wav_metadata(riff(chunk(b'fmt ', fmt), chunk(b'fact', struct.pack('<I', 13)), chunk(b'data', data)))

    def test_wave_ancillary_duplicates_and_malformed_chunks(self):
        raw = pcm_wave(b'\x7f' * 10, 11025, sample_width=1)
        body = raw[12:]
        annotated = riff(body, chunk(b'DISP', b'one'), chunk(b'DISP', b'two'))
        self.assertEqual(wav_metadata(annotated)['samples'], 10)
        for bad in (raw[:-1], raw + b'\0', riff(body, chunk(b'data', b'ab')), riff(chunk(b'data', b'ab'))):
            with self.assertRaises(ValueError):
                wav_metadata(bad)

    def test_mp3_frames_source_truncation_and_corruption(self):
        frame = bytes.fromhex('fffb38c0') + bytes(212)
        self.assertEqual(mp3_metadata(frame * 3), dict(codec='mp3', sampleRate=32000, channels=1, samples=3456, duration=0.108, frames=3))
        partial = frame + frame[:128]
        with self.assertRaisesRegex(ValueError, 'Truncated'):
            mp3_metadata(partial)
        recovered = mp3_metadata(partial, allow_truncated=True)
        self.assertEqual((recovered['completeBytes'], recovered['truncatedTailBytes'], recovered['missingLastFrameBytes']), (216, 128, 88))
        for bad in (b'', b'garbage', frame + b'abcd', frame[:-1]):
            with self.assertRaises(ValueError):
                mp3_metadata(bad, allow_truncated=True)
        self.assertFalse(mp3_header(bytes.fromhex('ffffabcd')))
        self.assertEqual(signature(bytes.fromhex('ffffabcd')), 'other')

    def test_index_preserves_members_and_rejects_outside_or_overlap(self):
        rows = [('voice.raw', 'MP3 ', 32, 100, 20), ('other.raw', 'ADPC', 52, 80, 20)]
        self.assertEqual(checked_records(index(rows), 72), rows)
        for bad in (index(rows)[:-1], index(rows)[:20], index([('bad.raw', 'ADPC', 31, 80, 20)]),
                    index([('bad.raw', 'ADPC', 32, 80, 0)]), index([rows[0], ('bad.raw', 'ADPC', 40, 80, 20)])):
            with self.assertRaises((ValueError, struct.error)):
                checked_records(bad, 72)
        with self.assertRaises(ValueError):
            checked_records(index(rows), 71)

    def test_concat_paths_are_literal_and_line_bounded(self):
        self.assertEqual(concat_file(Path("/a folder/voice's.mp3")), "file '/a folder/voice'\\''s.mp3'\n")
        with self.assertRaises(ValueError):
            concat_file('/a\nfile.mp3')


def directory_record(name, extent, size, directory=False):
    length = 33 + len(name) + (1 if len(name) % 2 == 0 else 0)
    raw = bytearray(length)
    raw[0] = length
    struct.pack_into('<I', raw, 2, extent); struct.pack_into('>I', raw, 6, extent)
    struct.pack_into('<I', raw, 10, size); struct.pack_into('>I', raw, 14, size)
    raw[25] = 2 if directory else 0
    raw[32] = len(name); raw[33:33 + len(name)] = name
    return bytes(raw)


def disc_bytes(name=b'VOICE.WAV;1'):
    blocks = [bytearray(2048) for _ in range(24)]
    blocks[16][:7] = b'\x01CD001\x01'
    blocks[16][40:72] = b'CM9_TEST'.ljust(32, b' ')
    struct.pack_into('<H', blocks[16], 128, 2048)
    root = directory_record(b'\0', 20, 2048, True)
    blocks[16][156:156 + len(root)] = root
    row = directory_record(name, 21, 5)
    blocks[20][:len(root) + len(row)] = root + row
    blocks[21][:5] = b'voice'
    header = b'\0' + b'\xff' * 10 + b'\0' + b'\0\0\0\1'
    return b''.join(header + block + bytes(288) for block in blocks)


class DiscBoundaryTests(unittest.TestCase):
    def test_reuse_verifies_loose_disc_payload_and_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); media = root / 'media'; output = root / 'output'
            media.mkdir(); (output / 'discs/TEST').mkdir(parents=True)
            source = media / 'original.bin'; source.write_bytes(b'original')
            extracted = output / 'discs/TEST/VOICE.DAT'; extracted.write_bytes(b'payload')
            manifest = dict(sources=[dict(path=source.name, sha256=sha256(source))],
                            discs=[dict(volume='TEST', files=[dict(path=extracted.name, sha256=sha256(extracted))])])
            (output / 'discs/disc-manifest.json').write_text(json.dumps(manifest))
            verify_reuse(output, media, dict(containers=[]))
            extracted.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'disc member'):
                verify_reuse(output, media, dict(containers=[]))
            source.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'source media'):
                verify_reuse(output, media, dict(containers=[]))

    def test_outer_zip_matches_actual_extracted_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'disc.bin'; source.write_bytes(b'original')
            with ZipFile(root / 'disc.zip', 'w') as archive:
                archive.writestr('disc.bin', b'original')
            rows = [dict(path='disc.bin', sha256=sha256(source))]
            self.assertEqual(verify_zips(root, rows)[0]['members'][0]['sha256'], sha256(source))
            with self.assertRaisesRegex(ValueError, 'differs'):
                verify_zips(root, [dict(path='disc.bin', sha256='changed')])
            with ZipFile(root / 'bad.zip', 'w') as archive:
                archive.writestr('../escape', b'data')
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                verify_zips(root, rows)

    def test_mode1_extents_read_cross_sector_and_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'disc.bin'; path.write_bytes(disc_bytes())
            disc = Disc(path)
            try:
                rows = list(disc.files())
                self.assertEqual(rows, [dict(path='VOICE.WAV', extent=21, bytes=5)])
                evidence = disc.extract(rows[0], Path(tmp) / 'output')
                self.assertEqual((Path(tmp) / 'output/VOICE.WAV').read_bytes(), b'voice')
                self.assertEqual(evidence['binUserOffset'], 21 * 2352 + 16)
                self.assertEqual(disc.read(21 * 2048 - 2, 7), b'\0\0voice')
                with self.assertRaises(ValueError):
                    disc.read(disc.user_size - 1, 2)
            finally:
                disc.close()

    def test_corrupt_sectors_records_and_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'disc.bin'
            path.write_bytes(disc_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, 'Truncated'):
                Disc(path)
            path.write_bytes(disc_bytes(b'../escape'))
            disc = Disc(path)
            try:
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    list(disc.files())
            finally:
                disc.close()
            raw = bytearray(disc_bytes()); raw[16 * 2352 + 15] = 2; path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'MODE1'):
                Disc(path)
