"""Strict metadata/decoding for formats actually observed on the CM9000 discs."""
import io
import struct
import wave

# DatFile.dll VA 0x10008030 and 0x10008070; see reconstruction notes.
INDEX = (-1, -1, -1, -1, 2, 4, 6, 8) * 2
STEPS = (7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41,
         45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209,
         230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876,
         963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
         3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
         10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
         29794, 32767)


def decode_adpc(source):
    """Headerless IMA: high nibble first, predictor/index zero, continuous state."""
    if not source:
        raise ValueError('Empty ADPC payload')
    predictor = index = 0
    output = bytearray(len(source) * 4)
    pos = 0
    for byte in source:
        for nibble in (byte >> 4, byte & 15):
            step = STEPS[index]
            delta = (step >> 3) + (step if nibble & 4 else 0) + (step >> 1 if nibble & 2 else 0) + (step >> 2 if nibble & 1 else 0)
            predictor = max(-32768, min(32767, predictor + (-delta if nibble & 8 else delta)))
            index = max(0, min(88, index + INDEX[nibble]))
            struct.pack_into('<h', output, pos, predictor)
            pos += 2
    return bytes(output)


def pcm_wave(pcm, sample_rate, channels=1, sample_width=2):
    if sample_rate <= 0 or channels <= 0 or sample_width not in (1, 2) or len(pcm) % (sample_width * channels):
        raise ValueError('Invalid PCM parameters/length')
    out = io.BytesIO()
    with wave.open(out, 'wb') as target:
        target.setparams((channels, sample_width, sample_rate, 0, 'NONE', 'not compressed'))
        target.writeframes(pcm)
    return out.getvalue()


def adpc_audio(source, declared):
    decoded = decode_adpc(source)
    if declared - len(decoded) not in (0, 2) or len(decoded) <= 44:
        raise ValueError('Unexpected ADPC declared length/header discrepancy')
    # CHESSMASTER.EXE 0x00507b13 exports decoded data from +0x2c, rebuilding its
    # header. Preserve the complete transform separately; do not play its header.
    audio = decoded[44:]
    metadata = dict(codec='cm9000_ima_adpcm', sampleRate=22050, channels=1,
                    samples=len(audio) // 2, duration=len(audio) / 44100,
                    decodedSamples=len(decoded) // 2, discardedHeaderBytes=44,
                    missingDeclaredSamples=(declared - len(decoded)) // 2)
    return decoded, pcm_wave(audio, 22050), metadata


def wav_metadata(raw):
    if len(raw) < 12 or raw[:4] != b'RIFF' or raw[8:12] != b'WAVE':
        raise ValueError('Expected RIFF/WAVE')
    end = struct.unpack_from('<I', raw, 4)[0] + 8
    if end != len(raw):
        raise ValueError('RIFF length mismatch')
    pos = 12
    chunks = {}
    while pos < end:
        if pos + 8 > end:
            raise ValueError('Truncated RIFF chunk header')
        tag, size = struct.unpack_from('<4sI', raw, pos)
        pos += 8
        if pos + size > end or tag in chunks and tag in (b'fmt ', b'data', b'fact'):
            raise ValueError('Truncated or duplicate RIFF chunk')
        chunks[tag] = raw[pos:pos + size]
        pos += size + size % 2
    fmt, data = chunks.get(b'fmt ', b''), chunks.get(b'data')
    if len(fmt) < 16 or data is None or not data or pos != end:
        raise ValueError('Missing/invalid WAVE format or data')
    tag, channels, rate, byte_rate, align, bits = struct.unpack_from('<HHIIHH', fmt)
    if not rate or not channels or not align:
        raise ValueError('Zero WAVE format parameter')
    if tag == 1 and bits in (8, 16):
        if align != channels * bits // 8 or len(data) % align or byte_rate != rate * align:
            raise ValueError('Invalid PCM WAVE block alignment')
        samples = len(data) // align
        codec = 'pcm_u8' if bits == 8 else 'pcm_s16le'
    elif tag == 0x11 and channels == 1 and bits == 4:
        remainder = len(data) % align
        if len(fmt) != 20 or struct.unpack_from('<H', fmt, 16)[0] != 2 or align < 4 or (remainder and remainder < 4):
            raise ValueError('Unsupported IMA WAV framing')
        block_samples = struct.unpack_from('<H', fmt, 18)[0]
        if block_samples != (align - 4) * 2 + 1:
            raise ValueError('Invalid IMA WAV samples per block')
        for offset in range(0, len(data), align):
            if data[offset + 2] > 88 or data[offset + 3]:
                raise ValueError('Invalid IMA WAV predictor header')
        samples = len(data) // align * block_samples + ((remainder - 4) * 2 + 1 if remainder else 0)
        encoded_samples = samples
        fact = chunks.get(b'fact')
        if fact is not None:
            if len(fact) != 4 or not 0 < struct.unpack('<I', fact)[0] <= samples:
                raise ValueError('Invalid IMA WAV fact sample count')
            samples = struct.unpack('<I', fact)[0]
        codec = 'adpcm_ima_wav'
    else:
        raise ValueError(f'Unsupported WAVE tag/channels/bits: {tag}/{channels}/{bits}')
    metadata = dict(codec=codec, sampleRate=rate, channels=channels, samples=samples,
                    duration=samples / rate, bits=bits, blockAlign=align)
    if tag == 0x11:
        metadata['encodedSamples'] = encoded_samples
        metadata['paddingSamples'] = encoded_samples - samples
    return metadata


def mp3_metadata(raw, allow_truncated=False):
    """Walk every MPEG-1/2/2.5 Layer III frame; reject free format and garbage."""
    pos = frames = samples = 0
    format_key = None
    while pos < len(raw):
        if pos + 4 > len(raw):
            raise ValueError('Truncated MP3 header')
        header = int.from_bytes(raw[pos:pos + 4], 'big')
        version, layer = (header >> 19) & 3, (header >> 17) & 3
        bitrate_index, rate_index = (header >> 12) & 15, (header >> 10) & 3
        if header >> 21 != 0x7ff or version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
            raise ValueError(f'Invalid MP3 frame at byte {pos}')
        rates = (44100, 48000, 32000)
        rate = rates[rate_index] // (1 if version == 3 else 2 if version == 2 else 4)
        bitrates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320) if version == 3 else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        bitrate = bitrates[bitrate_index] * 1000
        channels = 1 if (header >> 6) & 3 == 3 else 2
        key = (rate, channels, version)
        if format_key is not None and key != format_key:
            raise ValueError('MP3 format changes within clip')
        format_key = key
        size = (144 if version == 3 else 72) * bitrate // rate + ((header >> 9) & 1)
        if size < 4:
            raise ValueError('Invalid MP3 frame size')
        if pos + size > len(raw) and allow_truncated and frames:
            return dict(codec='mp3', sampleRate=rate, channels=channels, samples=samples,
                        duration=samples / rate, frames=frames, completeBytes=pos,
                        truncatedTailBytes=len(raw) - pos, missingLastFrameBytes=pos + size - len(raw))
        if pos + size > len(raw):
            raise ValueError('Truncated MP3 frame')
        samples += 1152 if version == 3 else 576
        frames += 1
        pos += size
    if not frames:
        raise ValueError('Empty MP3 payload')
    return dict(codec='mp3', sampleRate=rate, channels=channels, samples=samples,
                duration=samples / rate, frames=frames)


def mp3_header(raw):
    if len(raw) < 4:
        return False
    header = int.from_bytes(raw[:4], 'big')
    return (header >> 21 == 0x7ff and (header >> 19) & 3 != 1 and (header >> 17) & 3 == 1
            and (header >> 12) & 15 not in (0, 15) and (header >> 10) & 3 != 3)
