#!/usr/bin/env python3
"""Measure B09 standalone stem evidence without inventing promotion thresholds.

This tool consumes private runtime audio paths. It emits hashes, metadata and raw
acoustic measurements only. It never decides B09 PASS/FAIL because Benchmark v1
currently freezes metric names but no B09 numeric promotion thresholds.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from array import array
from pathlib import Path
from typing import Any

RATE = 48000
SILENCE_ABS = 1e-4
CLIP_ABS = 0.999


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run_json(cmd: list[str]) -> dict[str, Any]:
    proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(proc.stdout)


def ffprobe(path: Path) -> dict[str, Any]:
    data = run_json([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_fmt,sample_rate,channels,bits_per_sample,duration:format=duration",
        "-of", "json", str(path),
    ])
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    duration = stream.get("duration") or fmt.get("duration")
    return {
        "codec": stream.get("codec_name"),
        "sample_format": stream.get("sample_fmt"),
        "sample_rate_hz": int(stream["sample_rate"]) if stream.get("sample_rate") else None,
        "channels": int(stream["channels"]) if stream.get("channels") else None,
        "bit_depth": int(stream["bits_per_sample"]) if stream.get("bits_per_sample") else None,
        "duration_seconds": float(duration) if duration is not None else None,
    }


def decode_mono(path: Path, rate: int = RATE) -> array:
    proc = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(path), "-vn",
        "-ac", "1", "-ar", str(rate), "-f", "f32le", "pipe:1",
    ], check=True, capture_output=True)
    values = array("f")
    values.frombytes(proc.stdout)
    return values


def sample_stats(samples: array) -> dict[str, Any]:
    n = len(samples)
    if not n:
        return {"samples": 0, "peak_abs": None, "rms": None, "clipping_ratio": None, "silence_ratio": None}
    peak = 0.0
    energy = 0.0
    clipped = 0
    silent = 0
    for value in samples:
        a = abs(value)
        if a > peak:
            peak = a
        energy += value * value
        clipped += int(a >= CLIP_ABS)
        silent += int(a <= SILENCE_ABS)
    return {
        "samples": n,
        "peak_abs": peak,
        "rms": math.sqrt(energy / n),
        "clipping_ratio": clipped / n,
        "silence_ratio": silent / n,
    }


def correlation(a: array, b: array) -> float | None:
    n = min(len(a), len(b))
    if n < 2:
        return None
    mean_a = sum(a[:n]) / n
    mean_b = sum(b[:n]) / n
    num = 0.0
    den_a = 0.0
    den_b = 0.0
    for i in range(n):
        da = a[i] - mean_a
        db = b[i] - mean_b
        num += da * db
        den_a += da * da
        den_b += db * db
    den = math.sqrt(den_a * den_b)
    return num / den if den else None


def reconstruction_metrics(source: array, vocal: array, instrumental: array) -> dict[str, Any]:
    n = min(len(source), len(vocal), len(instrumental))
    if n == 0:
        return {"samples_compared": 0, "reconstruction_similarity": None, "phase_integrity": None, "residual_rms": None, "reconstruction_snr_db": None}
    source_energy = 0.0
    residual_energy = 0.0
    reconstructed = array("f")
    for i in range(n):
        recon = vocal[i] + instrumental[i]
        reconstructed.append(recon)
        source_energy += source[i] * source[i]
        residual = source[i] - recon
        residual_energy += residual * residual
    residual_rms = math.sqrt(residual_energy / n)
    snr = None
    if residual_energy > 0 and source_energy > 0:
        snr = 10.0 * math.log10(source_energy / residual_energy)
    corr = correlation(source[:n], reconstructed)
    return {
        "samples_compared": n,
        "reconstruction_similarity": corr,
        "phase_integrity": {"polarity_correlation": corr},
        "residual_rms": residual_rms,
        "reconstruction_snr_db": snr,
    }


def leakage(reference: Path | None, candidate: array) -> dict[str, Any]:
    if reference is None:
        return {"status": "not_measured", "reason": "independent_ground_truth_reference_not_supplied"}
    ref = decode_mono(reference)
    return {"status": "measured", "reference_correlation": correlation(ref, candidate)}


def asset_record(path: Path, samples: array) -> dict[str, Any]:
    return {
        "path_basename": path.name,
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "audio": ffprobe(path),
        "sample_stats": sample_stats(samples),
    }


def require_hash(label: str, actual: str, expected: str | None) -> None:
    if expected and actual.lower() != expected.lower():
        raise SystemExit(f"{label}_sha256_mismatch expected={expected} actual={actual}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--vocal", type=Path, required=True)
    parser.add_argument("--instrumental", type=Path, required=True)
    parser.add_argument("--reference-vocal", type=Path)
    parser.add_argument("--reference-instrumental", type=Path)
    parser.add_argument("--source-sha256")
    parser.add_argument("--vocal-sha256")
    parser.add_argument("--instrumental-sha256")
    parser.add_argument("--job-evidence", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = decode_mono(args.source)
    vocal = decode_mono(args.vocal)
    instrumental = decode_mono(args.instrumental)

    source_rec = asset_record(args.source, source)
    vocal_rec = asset_record(args.vocal, vocal)
    instrumental_rec = asset_record(args.instrumental, instrumental)
    require_hash("source", source_rec["sha256"], args.source_sha256)
    require_hash("vocal", vocal_rec["sha256"], args.vocal_sha256)
    require_hash("instrumental", instrumental_rec["sha256"], args.instrumental_sha256)

    durations = [source_rec["audio"]["duration_seconds"], vocal_rec["audio"]["duration_seconds"], instrumental_rec["audio"]["duration_seconds"]]
    finite_durations = [d for d in durations if isinstance(d, (int, float))]
    duration_divergence = max(finite_durations) - min(finite_durations) if finite_durations else None

    evidence = json.loads(args.job_evidence.read_text(encoding="utf-8")) if args.job_evidence else None
    result = {
        "test_id": "B09",
        "measurement_state": "measured",
        "promotion_state": "not_decided_by_this_tool",
        "promotion_reason": "B09 Benchmark v1 has no frozen numeric metric thresholds; do not infer PASS from raw measurements alone.",
        "runtime": {"decoder": "ffmpeg", "analysis_sample_rate_hz": RATE},
        "job_evidence": evidence,
        "assets": {"source": source_rec, "guide_vocal": vocal_rec, "instrumental": instrumental_rec},
        "automated_metrics": {
            "duration_divergence_seconds": duration_divergence,
            "stem_isolation": {
                "guide_vocal_silence_ratio": vocal_rec["sample_stats"]["silence_ratio"],
                "instrumental_silence_ratio": instrumental_rec["sample_stats"]["silence_ratio"],
            },
            "leakage": {
                "guide_vocal": leakage(args.reference_vocal, vocal),
                "instrumental": leakage(args.reference_instrumental, instrumental),
            },
            **reconstruction_metrics(source, vocal, instrumental),
            "clipping": {
                "guide_vocal_ratio": vocal_rec["sample_stats"]["clipping_ratio"],
                "instrumental_ratio": instrumental_rec["sample_stats"]["clipping_ratio"],
            },
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"B09_MEASURED {args.output}")


if __name__ == "__main__":
    main()
