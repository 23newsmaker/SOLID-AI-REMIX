"""Bounded CPU-only Indonesian TTS experiment; never loads app/user data.

Model: anak10thn/pocket-tts-indonesian, CC-BY-4.0.
Prompts: repository voices/, Common Voice 22 Indonesian, CC0.
Inference adapted from PocketTTS-RAVEN; see THIRD_PARTY_NOTICES.md.
Uses already-downloaded ONNX assets, no remote Python/model execution.
"""
import json
import os
from pathlib import Path
import resource
import subprocess
import time
import wave

import numpy as np
import onnxruntime as ort
import sentencepiece as spm

ROOT = Path(__file__).resolve().parents[2] / "generated-artifacts/voice-local-test"
MODELS = ROOT / "onnx"
TEXT = "Selamat datang di Solid Gold. Kenali produk Mini, Mikro, dan Regular sesuai kebutuhan Anda."
SR = 24000


def session(name):
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 2
    settings.inter_op_num_threads = 1
    settings.log_severity_level = 3
    return ort.InferenceSession(str(MODELS / f"{name}.onnx"), settings, providers=["CPUExecutionProvider"])


def state(session):
    dtypes = {"tensor(float)": np.float32, "tensor(float16)": np.float16,
              "tensor(int64)": np.int64, "tensor(bool)": np.bool_}
    return {v.name: (np.ones if v.type == "tensor(bool)" else np.zeros)(v.shape, dtype=dtypes[v.type])
            for v in session.get_inputs() if v.name.startswith("state_")}


def run_state(session, inputs, cache, offset):
    result = session.run(None, {**inputs, **cache})
    names = list(cache)
    assert len(result) == len(names) + offset
    cache.update(zip(names, result[offset:]))
    return result


def load_wav(path):
    with wave.open(str(path), "rb") as wav:
        assert wav.getframerate() == SR and wav.getnchannels() == 1 and wav.getsampwidth() == 2
        return np.frombuffer(wav.readframes(-1), np.int16).astype(np.float32).reshape(1, 1, -1) / 32768


def main():
    started = time.perf_counter()
    encoder, text_encoder, backbone, flow, decoder = [session(n) for n in
        ["mimi_encoder", "text_conditioner", "flow_lm_main_int8", "flow_lm_flow_int8", "mimi_decoder_int8"]]
    tokenizer = spm.SentencePieceProcessor(model_file=str(MODELS / "tokenizer.model"))
    bos = np.load(MODELS / "bos_before_voice.npy").astype(np.float32)
    empty_sequence = np.zeros((1, 0, 32), np.float32)
    empty_text = np.zeros((1, 0, 1024), np.float32)
    ids = np.array(tokenizer.encode(TEXT), np.int64).reshape(1, -1)
    text = text_encoder.run(None, {"token_ids": ids})[0].reshape(1, -1, 1024)
    results = []
    loaded = time.perf_counter() - started
    for label, source in [("A", "19961910"), ("B", "20954552")]:
        start = time.perf_counter()
        voice_path = ROOT / f"reference-{label}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i",
            str(ROOT / "voices" / f"common_voice_id_{source}.mp3"),
            "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", str(voice_path)], check=True, timeout=10)
        sample = load_wav(voice_path)
        embeddings = encoder.run(None, {"audio": sample})[0].reshape(1, -1, 1024)
        voice = np.concatenate([bos, embeddings], axis=1)
        cache = state(backbone)
        run_state(backbone, {"sequence": empty_sequence, "text_embeddings": voice}, cache, 2)
        run_state(backbone, {"sequence": empty_sequence, "text_embeddings": text}, cache, 2)
        conditioned = time.perf_counter()
        current = np.full((1, 1, 32), np.nan, np.float32)
        latents, eos_step = [], None
        rng = np.random.default_rng(42)  # Same seed/text for both prompts.
        for step in range(250):  # hard cap: 20 seconds of audio
            if time.perf_counter() - start > 90:
                raise TimeoutError("CPU experiment exceeded 90 seconds per voice")
            result = run_state(backbone, {"sequence": current, "text_embeddings": empty_text}, cache, 2)
            conditioning, eos = result[:2]
            assert np.isfinite(conditioning).all(), "Non-finite conditioning"
            if float(eos.reshape(-1)[0]) > -6 and eos_step is None:
                eos_step = step
            if eos_step is not None and step >= eos_step + 3:
                break
            noise = rng.normal(0, np.sqrt(0.3), (1, 32)).astype(np.float32)
            direction = flow.run(None, {"c": conditioning, "s": np.zeros((1, 1), np.float32),
                "t": np.ones((1, 1), np.float32), "x": noise})[0]
            current = (noise + direction).reshape(1, 1, 32)
            assert np.isfinite(current).all()
            latents.append(current)
        assert eos_step is not None, "Generation reached audio cap without EOS"
        decoding = time.perf_counter()
        all_latents = np.concatenate(latents, axis=1)
        cache = state(decoder)
        audio_parts = []
        for i in range(0, len(latents), 15):
            result = run_state(decoder, {"latent": all_latents[:, i:i + 15]}, cache, 1)
            audio_parts.append(result[0].reshape(-1))
        audio = np.concatenate(audio_parts)
        assert np.isfinite(audio).all() and np.max(np.abs(audio)) > 0.01
        path = ROOT / f"voice-{label}.wav"
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(SR)
            wav.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        elapsed = time.perf_counter() - start
        result = {"voice": label, "source": source, "file": path.name,
            "reference_seconds": sample.shape[-1] / SR, "audio_seconds": round(len(audio) / SR, 3),
            "total_seconds": round(elapsed, 3), "conditioning_seconds": round(conditioned - start, 3),
            "flow_seconds": round(decoding - conditioned, 3),
            "seconds_compute_per_audio_second": round(elapsed / (len(audio) / SR), 3),
            "rms": round(float(np.sqrt(np.mean(audio * audio))), 4),
            "clipped_fraction": round(float(np.mean(np.abs(audio) >= 1)), 5),
            "peak_process_rss_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}
        results.append(result)
        print(json.dumps(result), flush=True)
    report = {"model": "anak10thn/pocket-tts-indonesian", "revision": "382fe85ca848546efb04bf1b7fdba78c6396e2ce",
        "model_license": "CC-BY-4.0", "prompt_license": "CC0", "cpu_threads": 2,
        "onnxruntime_version": ort.__version__, "text": TEXT, "model_load_seconds": round(loaded, 3),
        "results": results, "pronunciation_review": "NOT_REVIEWED", "speaker_identity_accuracy": "NOT_MEASURED",
        "note": "No app data, user recordings, paid APIs, or GPU used. Technical audio generation does not prove clone identity or correct pronunciation."}
    (ROOT / "results.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    # Prevent this standalone process from competing with the app at normal priority.
    os.nice(10)
    main()
