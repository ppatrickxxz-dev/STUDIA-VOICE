import json
from pathlib import Path

ROOT = Path(__file__).parent
PLAN = ROOT / "assets" / "pitch-note-correction.json"
EXPECTED_FUNCTION_SHA256 = "f008b139bc9e4022f497e04c3a52fd91e7d4a9ba3e16ddb32962e4fb2b1fbca1"
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
    if data.get("benchmark") != "PabloVoice Benchmark v1": fail("unexpected benchmark")
    if data.get("purpose") != "B06 guarded pitch and target-note correction plan": fail("purpose changed")
    if data.get("frozen_before_first_b06_benchmark_output") is not True: fail("plan must remain frozen before first output")
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

    if data.get("observed_execution") is not None:
        fail("B06 observed_execution must remain null until a real retained benchmark run is reviewed and explicitly promoted")

    print("B06 CONTRACT PASSED")
    print("Note-aware correction policy, formant/vibrato guards, backend hash, and no-score-before-evidence rule are locked.")


if __name__ == "__main__":
    main()
