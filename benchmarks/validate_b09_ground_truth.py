#!/usr/bin/env python3
"""Prospective B09 ground-truth gate.

This is deliberately separate from validate_b09.py. The historical B09 run had no
independent ground truth and therefore cannot be promoted retroactively. This gate
is only valid for a controlled mixture whose clean vocal and clean instrumental
references are retained alongside the provider outputs.

The thresholds below are frozen *before the first physical execution* of this gate.
Do not tune them after observing a result. A failed run must remain a failed run.
"""

from __future__ import annotations

import argparse
import json
import math
from array import array
from pathlib import Path
from typing import Any

from validate_b09 import (
    asset_record,
    correlation,
    decode_mono,
    reconstruction_metrics,
    require_hash,
)

# Prospective B09 v2 thresholds. Freeze before first execution.
THRESHOLDS: dict[str, float] = {
    "min_vocal_si_sdr_db": 6.0,
    "min_instrumental_si_sdr_db": 6.0,
    "min_vocal_target_to_interference_db": 10.0,
    "min_instrumental_target_to_interference_db": 10.0,
    "min_vocal_target_correlation": 0.80,
    "min_instrumental_target_correlation": 0.80,
    "min_reconstruction_snr_db": 20.0,
    "min_reconstruction_polarity_correlation": 0.95,
    "max_duration_divergence_seconds": 0.15,
    "max_stem_clipping_ratio": 0.01,
}


def _dot(a: array, b: array, n: int) -> float:
    return sum(a[i] * b[i] for i in range(n))


def _energy(a: array, n: int) -> float:
    return sum(a[i] * a[i] for i in range(n))


def si_sdr_db(estimate: array, reference: array) -> float | None:
    """Scale-invariant SDR using the target projection formulation."""
    n = min(len(estimate), len(reference))
    if n < 2:
        return None
    ref_energy = _energy(reference, n)
    if ref_energy <= 0:
        return None
    alpha = _dot(estimate, reference, n) / ref_energy
    target_energy = 0.0
    residual_energy = 0.0
    for i in range(n):
        target = alpha * reference[i]
        residual = estimate[i] - target
        target_energy += target * target
        residual_energy += residual * residual
    if target_energy <= 0:
        return None
    if residual_energy <= 0:
        return float("inf")
    return 10.0 * math.log10(target_energy / residual_energy)


def target_to_interference_db(
    estimate: array,
    target_reference: array,
    interference_reference: array,
) -> float | None:
    """Measure retained target energy against leaked interference energy.

    The interference reference is first orthogonalized against the target reference
    so correlated musical/vocal content is not counted twice. Higher is better.
    """
    n = min(len(estimate), len(target_reference), len(interference_reference))
    if n < 2:
        return None

    target_energy = _energy(target_reference, n)
    if target_energy <= 0:
        return None

    cross = _dot(interference_reference, target_reference, n)
    beta = cross / target_energy
    orth = array("f", (interference_reference[i] - beta * target_reference[i] for i in range(n)))
    orth_energy = _energy(orth, n)
    if orth_energy <= 0:
        return None

    target_gain = _dot(estimate, target_reference, n) / target_energy
    interference_gain = _dot(estimate, orth, n) / orth_energy
    retained_target_energy = target_gain * target_gain * target_energy
    leaked_interference_energy = interference_gain * interference_gain * orth_energy

    if retained_target_energy <= 0:
        return None
    if leaked_interference_energy <= 0:
        return float("inf")
    return 10.0 * math.log10(retained_target_energy / leaked_interference_energy)


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def _at_least(value: Any, threshold: float) -> bool:
    return _finite(value) and float(value) >= threshold


def _at_most(value: Any, threshold: float) -> bool:
    return _finite(value) and float(value) <= threshold


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--reference-vocal", type=Path, required=True)
    parser.add_argument("--reference-instrumental", type=Path, required=True)
    parser.add_argument("--estimated-vocal", type=Path, required=True)
    parser.add_argument("--estimated-instrumental", type=Path, required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--reference-vocal-sha256", required=True)
    parser.add_argument("--reference-instrumental-sha256", required=True)
    parser.add_argument("--estimated-vocal-sha256", required=True)
    parser.add_argument("--estimated-instrumental-sha256", required=True)
    parser.add_argument("--job-evidence", type=Path, required=True)
    parser.add_argument("--mixture-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = decode_mono(args.source)
    ref_vocal = decode_mono(args.reference_vocal)
    ref_instrumental = decode_mono(args.reference_instrumental)
    est_vocal = decode_mono(args.estimated_vocal)
    est_instrumental = decode_mono(args.estimated_instrumental)

    records = {
        "source": asset_record(args.source, source),
        "reference_vocal": asset_record(args.reference_vocal, ref_vocal),
        "reference_instrumental": asset_record(args.reference_instrumental, ref_instrumental),
        "estimated_vocal": asset_record(args.estimated_vocal, est_vocal),
        "estimated_instrumental": asset_record(args.estimated_instrumental, est_instrumental),
    }
    require_hash("source", records["source"]["sha256"], args.source_sha256)
    require_hash("reference_vocal", records["reference_vocal"]["sha256"], args.reference_vocal_sha256)
    require_hash("reference_instrumental", records["reference_instrumental"]["sha256"], args.reference_instrumental_sha256)
    require_hash("estimated_vocal", records["estimated_vocal"]["sha256"], args.estimated_vocal_sha256)
    require_hash("estimated_instrumental", records["estimated_instrumental"]["sha256"], args.estimated_instrumental_sha256)

    durations = [
        records[key]["audio"]["duration_seconds"]
        for key in records
        if records[key]["audio"]["duration_seconds"] is not None
    ]
    duration_divergence = max(durations) - min(durations) if durations else None

    recon = reconstruction_metrics(source, est_vocal, est_instrumental)
    recon_corr = (recon.get("phase_integrity") or {}).get("polarity_correlation")

    metrics = {
        "vocal": {
            "si_sdr_db": si_sdr_db(est_vocal, ref_vocal),
            "target_correlation": correlation(est_vocal, ref_vocal),
            "wrong_reference_correlation": correlation(est_vocal, ref_instrumental),
            "target_to_interference_db": target_to_interference_db(est_vocal, ref_vocal, ref_instrumental),
            "clipping_ratio": records["estimated_vocal"]["sample_stats"]["clipping_ratio"],
        },
        "instrumental": {
            "si_sdr_db": si_sdr_db(est_instrumental, ref_instrumental),
            "target_correlation": correlation(est_instrumental, ref_instrumental),
            "wrong_reference_correlation": correlation(est_instrumental, ref_vocal),
            "target_to_interference_db": target_to_interference_db(est_instrumental, ref_instrumental, ref_vocal),
            "clipping_ratio": records["estimated_instrumental"]["sample_stats"]["clipping_ratio"],
        },
        "reconstruction": recon,
        "duration_divergence_seconds": duration_divergence,
    }

    checks = {
        "vocal_si_sdr": _at_least(metrics["vocal"]["si_sdr_db"], THRESHOLDS["min_vocal_si_sdr_db"]),
        "instrumental_si_sdr": _at_least(metrics["instrumental"]["si_sdr_db"], THRESHOLDS["min_instrumental_si_sdr_db"]),
        "vocal_leakage": _at_least(metrics["vocal"]["target_to_interference_db"], THRESHOLDS["min_vocal_target_to_interference_db"]),
        "instrumental_leakage": _at_least(metrics["instrumental"]["target_to_interference_db"], THRESHOLDS["min_instrumental_target_to_interference_db"]),
        "vocal_correlation": _at_least(metrics["vocal"]["target_correlation"], THRESHOLDS["min_vocal_target_correlation"]),
        "instrumental_correlation": _at_least(metrics["instrumental"]["target_correlation"], THRESHOLDS["min_instrumental_target_correlation"]),
        "reconstruction_snr": _at_least(recon.get("reconstruction_snr_db"), THRESHOLDS["min_reconstruction_snr_db"]),
        "reconstruction_polarity": _at_least(recon_corr, THRESHOLDS["min_reconstruction_polarity_correlation"]),
        "duration_divergence": _at_most(duration_divergence, THRESHOLDS["max_duration_divergence_seconds"]),
        "vocal_clipping": _at_most(metrics["vocal"]["clipping_ratio"], THRESHOLDS["max_stem_clipping_ratio"]),
        "instrumental_clipping": _at_most(metrics["instrumental"]["clipping_ratio"], THRESHOLDS["max_stem_clipping_ratio"]),
    }
    passed = all(checks.values())

    result = {
        "test_id": "B09",
        "protocol": "prospective_controlled_ground_truth_v1",
        "measurement_state": "measured",
        "promotion_state": "pass" if passed else "fail",
        "threshold_freeze": {
            "status": "frozen_before_first_physical_execution",
            "policy": "never_lower_after_observing_result",
            "thresholds": THRESHOLDS,
        },
        "mixture_manifest": json.loads(args.mixture_manifest.read_text(encoding="utf-8")),
        "job_evidence": json.loads(args.job_evidence.read_text(encoding="utf-8")),
        "assets": records,
        "metrics": metrics,
        "checks": checks,
        "passed": passed,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(("B09_GROUND_TRUTH_PASS" if passed else "B09_GROUND_TRUTH_FAIL"), args.output)
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
