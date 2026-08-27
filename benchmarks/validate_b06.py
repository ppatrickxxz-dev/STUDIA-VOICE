import json
from pathlib import Path
from validate_b04 import main as validate_b04_main

ROOT = Path(__file__).parent
PLAN = ROOT / "assets" / "pitch-note-correction.json"
SMOKE = ROOT / "results" / "b06-smoke-81c74a6f.json"
EXPECTED_FUNCTION_SHA256 = "f008b139bc9e4022f497e04c3a52fd91e7d4a9ba3e16ddb32962e4fb2b1fbca1"
EXPECTED_SMOKE_JOB_ID = "81c74a6f-012f-47b8-a013-67f018445a0c"
EXPECTED_SMOKE_OUTPUT_SHA256 = "87177efef84078709bd46bed625e991168338ddc969da05d8727b23fed4b85b1"
EXPECTED_POLICY = {
    "min_event_seconds": 0.18,
    "min_confidence": 0.72,
    "deadband_cents": 12,
    "max_correction_cents": 45,
    "crossfade_seconds": 0.035,
    "preserve_formants": True,
    "preserve_relative_vibrato": True,
}


def fail(message: str) -> None:
    raise SystemExit(f"B06 CONTRACT FAILED: {message}")


def main() -> None:
    data = json.loads(PLAN.read_text(encoding="utf-8"))
    smoke = json.loads(SMOKE.read_text(encoding="utf-8"))
    if data.get("benchmark") != "PabloVoice Benchmark v1": fail("unexpected benchmark")
    if data.get("purpose") != "B06 guarded pitch and target-note correction plan": fail("purpose changed")
    if data.get("frozen_before_first_b06_benchmark_output") is not True: fail("plan must remain frozen before first benchmark output")
    if data.get("input_domain") != "edit_reference": fail("B06 must remain on edit_reference")
    if data.get("target_strategy") != "explicit_or_nearest_chromatic": fail("target strategy changed")
    if data.get("policy") != EXPECTED_POLICY: fail("frozen correction policy changed")

    req = data.get("requirements", {})
    required_true = (
        "note_aware_detection_required",
        "constant_median_shift_per_stable_note",
        "framewise_hard_snap_forbidden",
        "low_confidence_regions_must_remain_unmodified",
        "within_deadband_regions_must_remain_unmodified",
        "over_guard_corrections_must_fail_closed",
        "boundary_crossfade_required",
        "formant_preservation_required",
        "relative_vibrato_preservation_required",
        "retained_acoustic_output_required_for_score",
    )
    for key in required_true:
        if req.get(key) is not True: fail(f"requirement {key} must remain true")

    route = data.get("route_evidence", {})
    if route.get("deployed_function_sha256") != EXPECTED_FUNCTION_SHA256: fail("deployed function hash changed")
    if route.get("endpoint") != "diagnose-voice-v70-once": fail("legacy slot changed without explicit benchmark revision")
    if route.get("legacy_slot_reused") is not True: fail("legacy slot evidence removed")
    if route.get("source_asset_must_be_owned_and_sha_verified") is not True: fail("source verification requirement removed")
    if route.get("authenticated_dispatch_required") is not True: fail("authenticated dispatch requirement removed")
    if route.get("callback_uses_expiring_hashed_token") is not True: fail("callback token protection removed")

    observed = data.get("observed_execution")
    if not isinstance(observed, dict): fail("B06 engineering smoke evidence missing")
    if observed.get("kind") != "engineering_smoke_not_score": fail("B06 observed execution must remain a non-scoring engineering smoke")
    if observed.get("benchmark_score_eligible") is not False: fail("B06 smoke must never be benchmark-score eligible")
    if observed.get("source_is_frozen_benchmark_vocal") is not False: fail("B06 smoke source must not be mislabeled as frozen benchmark vocal")
    if observed.get("does_not_satisfy_b06_score_requirement") is not True: fail("B06 smoke must remain explicitly non-promotable")
    if observed.get("job_id") != EXPECTED_SMOKE_JOB_ID: fail("unexpected B06 smoke job")
    if observed.get("output_sha256") != EXPECTED_SMOKE_OUTPUT_SHA256: fail("unexpected B06 smoke output hash")

    if smoke.get("kind") != "engineering_smoke_not_score": fail("B06 smoke result kind changed")
    if smoke.get("benchmark_score_eligible") is not False: fail("B06 smoke result became score eligible")
    if smoke.get("job_id") != EXPECTED_SMOKE_JOB_ID: fail("B06 smoke result job changed")
    if smoke.get("source", {}).get("is_frozen_benchmark_vocal") is not False: fail("B06 smoke result source mislabeled")
    if smoke.get("output", {}).get("sha256") != EXPECTED_SMOKE_OUTPUT_SHA256: fail("B06 smoke result hash changed")
    if smoke.get("promotion_rule", "").find("does not score or pass B06") < 0: fail("B06 smoke non-promotion rule removed")

    metrics = smoke.get("metrics", {})
    if metrics.get("median_abs_cents_after", 999) > metrics.get("median_abs_cents_before", -1): fail("B06 smoke no longer demonstrates pitch-error improvement")
    if not 0.9 <= float(metrics.get("median_vibrato_ratio", 0)) <= 1.1: fail("B06 smoke vibrato preservation left guard band")

    print("B06 CONTRACT PASSED")
    print("Note-aware correction policy is locked; retained smoke evidence is locked as non-scoring and non-promotable.")


if __name__ == "__main__":
    validate_b04_main()
    main()
