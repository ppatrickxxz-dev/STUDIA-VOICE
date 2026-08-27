import json
from pathlib import Path

ROOT = Path(__file__).parent
PLAN = ROOT / "assets" / "arrangement-change.json"
EXPECTED_INSTRUMENTAL_SHA = "4908fa56f7475fd01ca1359701933ce4550de68c04418fba9c1a0fb117d0ff6a"
EXPECTED_MIX_SHA = "4f480dd3f8417b38a78d1c7cb7d3fe02aef1c1aaa2d1bc439f3dd350c6c68fd9"
EXPECTED_AUDIO_ENGINE_SHA = "7d6ee67ab51082ec33cc479784585372575f44ef"
EXPECTED_REGION_GAIN_SHA = "5ad2688ea1acec70fa5ed7190d3f0449b6da2561"
EXPECTED_REGION_TIME_SHA = "207ce06b8330cd962d73457baf6144c5db80747b"
EXPECTED_POLICY = {
    "source": "b08_arrangement_v1",
    "mode": "attenuation_only",
    "min_gain_db": -12,
    "max_gain_db": 0,
    "max_regions": 12,
    "preserve_lead_track": True,
    "preserve_lyrics": True,
    "preserve_track_order": True,
    "preserve_asset_identity": True,
    "preserve_song_duration": True,
}
EXPECTED_REGIONS = [
    {"id":"A1_opening_space","label":"opening_space","start_seconds":0.0,"end_seconds":12.0,"gain_db":-8.0},
    {"id":"A2_first_contrast","label":"first_contrast","start_seconds":18.0,"end_seconds":34.0,"gain_db":-3.0},
    {"id":"A3_mid_break","label":"mid_break","start_seconds":72.0,"end_seconds":88.0,"gain_db":-5.0},
    {"id":"A4_late_breakdown","label":"late_breakdown","start_seconds":112.0,"end_seconds":128.0,"gain_db":-7.0},
    {"id":"A5_outro_space","label":"outro_space","start_seconds":168.0,"end_seconds":184.96,"gain_db":-6.0},
]


def fail(message: str) -> None:
    raise SystemExit(f"B08 CONTRACT FAILED: {message}")


def main() -> None:
    data = json.loads(PLAN.read_text(encoding="utf-8"))
    if data.get("benchmark") != "PabloVoice Benchmark v1": fail("unexpected benchmark")
    if data.get("purpose") != "B08 guarded macro-arrangement density change": fail("purpose changed")
    if data.get("frozen_before_first_b08_benchmark_output") is not True: fail("plan must remain frozen pre-output")
    if data.get("input_domain") != "edit_reference": fail("B08 must use edit_reference")
    if data.get("scope") != "macro_arrangement_density_only": fail("scope changed")
    if data.get("policy") != EXPECTED_POLICY: fail("policy changed")
    if data.get("regions") != EXPECTED_REGIONS: fail("frozen arrangement regions changed")

    boundary = data.get("scope_boundary", {})
    for key in ("regenerates_instruments", "changes_notes_or_melody", "changes_lyrics", "changes_vocal_identity", "changes_song_form_or_duration"):
        if boundary.get(key) is not False: fail(f"scope boundary {key} must remain false")
    if boundary.get("changes_accompaniment_density_by_time_local_gain") is not True:
        fail("time-local accompaniment-density change removed")

    ref = data.get("reference", {})
    if ref.get("duration_seconds") != 184.96: fail("reference duration changed")
    if ref.get("instrumental_sha256") != EXPECTED_INSTRUMENTAL_SHA: fail("reference instrumental changed")
    if ref.get("reference_mix_sha256") != EXPECTED_MIX_SHA: fail("reference mix changed")

    req = data.get("requirements", {})
    for key in (
        "explicit_instrumental_target_ids_required",
        "lead_vocal_must_never_be_targeted",
        "lead_vocal_track_state_must_remain_identical",
        "lyrics_must_remain_identical",
        "track_order_must_remain_identical",
        "asset_ids_must_remain_identical",
        "trim_offset_gain_pan_mute_solo_effects_must_remain_identical",
        "non_target_region_automation_must_remain_identical",
        "song_duration_must_remain_identical",
        "positive_gain_boost_forbidden",
        "runtime_playback_and_offline_render_must_apply_region_automation",
        "retained_acoustic_output_required_for_score",
    ):
        if req.get(key) is not True: fail(f"requirement {key} must remain true")

    runtime = data.get("runtime_evidence", {})
    if runtime.get("audio_engine_sha") != EXPECTED_AUDIO_ENGINE_SHA: fail("audio engine evidence changed")
    if runtime.get("region_gain_sha") != EXPECTED_REGION_GAIN_SHA: fail("region gain evidence changed")
    if runtime.get("region_time_sha") != EXPECTED_REGION_TIME_SHA: fail("region time evidence changed")
    for key in ("region_automation_persisted_in_project_schema", "region_automation_used_in_playback", "region_automation_used_in_offline_render"):
        if runtime.get(key) is not True: fail(f"runtime evidence {key} removed")

    if data.get("observed_execution") is not None:
        fail("B08 observed execution must remain null until retained frozen-reference output is reviewed")

    print("B08 CONTRACT PASSED")
    print("Macro-arrangement scope, frozen regions, preservation guards and no-score-before-output rule are locked.")


if __name__ == "__main__":
    main()
