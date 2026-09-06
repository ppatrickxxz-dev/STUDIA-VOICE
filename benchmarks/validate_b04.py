import json
from pathlib import Path

ROOT = Path(__file__).parent
PLAN = ROOT / "assets" / "voice-identity-preservation.json"
SMOKES = ROOT / "results" / "b04-rvc-v71-smokes.json"

EXPECTED = {
    "guide_sha256": "ac5a5e63f5f263f8a083ad7942229cb5cd546f627033a1de61148e355ef40816",
    "identity_sha256": "5d02cef6ddb423f95485f2f202dba0c1634ab7a001307743f631f5078a2f1439",
    "pth_sha256": "58f0354124a4a18a0a5bd1f8c74bd95b6147713dcb23b98d9060a5bc63bda56a",
    "index_sha256": "814feab12db225c2e1e0a43a661238dc587a7d1554343ca7223103be16fd930f",
    "compute_sha256": "2969d50b9404b8d5b64eab631d1211d4dec698a3edb86a6ee3956c08db9aeca4",
    "ticket_sha256": "dfe9b61f5c67f716949fbe3aaaeeac50b8e41df36c0bab0a3ea752fa789d4af5",
    "worker_sha256": "556fa48bc2edc02da42a800d236be34677cfd99fb3399717baaaaadbd8f5b5ea",
    "complete_sha256": "eaa57aabfb261feb9a0abf472c88f8dc04ce1a112c8f8e47355b82ccdc6e55bb",
}


def fail(message: str) -> None:
    raise SystemExit(f"B04 CONTRACT FAILED: {message}")


def main() -> None:
    data = json.loads(PLAN.read_text(encoding="utf-8"))
    smoke = json.loads(SMOKES.read_text(encoding="utf-8"))

    if data.get("benchmark") != "PabloVoice Benchmark v1": fail("unexpected benchmark")
    if data.get("purpose") != "B04 localized vocal identity preservation": fail("purpose changed")
    if data.get("frozen_before_first_b04_benchmark_output") is not True: fail("plan must remain frozen")
    if data.get("input_domain") != "edit_reference": fail("B04 must remain edit_reference")
    if data.get("scope") != "selected_phrase_voice_conversion": fail("scope changed")

    region = data.get("region", {})
    if region.get("start_seconds") != 64.0 or region.get("end_seconds") != 72.0 or region.get("duration_seconds") != 8.0:
        fail("frozen region changed")

    guide = data.get("guide", {})
    if guide.get("sha256") != EXPECTED["guide_sha256"]: fail("guide hash changed")
    if guide.get("derived_from_source_sha256") != "ff57cb304fbe72783b78ab5f43137cd3daba2736e76135d86beb0e1f8f0e6e2d": fail("guide lineage changed")

    identity = data.get("identity_reference", {})
    if identity.get("frozen_provider_input_sha256") != EXPECTED["identity_sha256"]: fail("identity reference hash changed")
    for key in ("required", "must_be_owned", "must_be_sha_verified", "must_be_active_for_voice_model"):
        if identity.get(key) is not True: fail(f"identity guard {key} removed")

    model = data.get("voice_model", {})
    if model.get("pth_sha256") != EXPECTED["pth_sha256"] or model.get("index_sha256") != EXPECTED["index_sha256"]:
        fail("voice model hashes changed")

    recipe = data.get("recipe", {})
    expected_recipe = {
        "profile": "identity", "pitch": 0, "index_rate": 0.70, "protect": 0.50,
        "f0_method": "rmvpe", "embedder_model": "contentvec", "split_audio": True,
        "f0_autotune": False, "clean_audio": False, "formant_shifting": False,
        "applio_commit": "085197e738ce9dd4c0bae1e0a74df5de25b89444",
    }
    if recipe != expected_recipe: fail("frozen identity recipe changed")

    req = data.get("requirements", {})
    for key in (
        "exact_guide_asset_and_sha_required", "exact_region_required", "full_guide_conversion_not_score_eligible",
        "exact_voice_model_hashes_required", "exact_identity_reference_sha_required", "identity_reference_must_be_active_and_owned",
        "pitch_shift_forbidden", "autotune_forbidden", "formant_shift_forbidden", "output_pcm_must_differ_from_guide_pcm",
        "private_retained_flac_required", "timbre_similarity_review_required", "formant_stability_review_required",
        "performance_naturalness_review_required", "speaker_consistency_review_required", "human_blind_review_required_for_score",
    ):
        if req.get(key) is not True: fail(f"requirement {key} removed")

    route = data.get("route_evidence", {})
    for key in ("authenticated_dispatch_required", "localized_region_guard_deployed", "identity_reference_guard_deployed", "exact_guide_and_model_hash_guard_deployed"):
        if route.get(key) is not True: fail(f"route guard {key} missing")
    for key in ("compute_sha256", "ticket_sha256", "worker_sha256", "complete_sha256"):
        if route.get(key) != EXPECTED[key]: fail(f"deployed {key} changed")

    if data.get("observed_execution") is not None: fail("official B04 execution must remain null until frozen localized run is reviewed")

    if smoke.get("test") != "B04" or smoke.get("kind") != "engineering_smoke_not_score": fail("smoke classification changed")
    if smoke.get("benchmark_score_eligible") is not False or smoke.get("promotion_forbidden") is not True: fail("historical smokes must remain non-scoring")
    runs = smoke.get("runs", [])
    if {r.get("profile") for r in runs} != {"natural", "identity", "smooth"}: fail("historical smoke set changed")
    if any(float(r.get("duration_seconds", 0)) < 170 for r in runs): fail("historical full-guide smokes were rewritten as localized evidence")

    print("B04 CONTRACT PASSED")
    print("Localized 64-72s identity profile, frozen hashes, live route hashes, and no-score-before-retained-review are locked.")


if __name__ == "__main__":
    main()
