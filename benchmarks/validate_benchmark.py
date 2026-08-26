import json
from pathlib import Path

ROOT = Path(__file__).parent
MANIFEST = ROOT / "pablovoice-benchmark-v1.json"
GENERATION_BRIEF = ROOT / "assets" / "frozen-brief.json"
REFERENCE_ANALYSIS = ROOT / "assets" / "reference-analysis.json"

REQUIRED_TEST_IDS = {f"B{i:02d}" for i in range(1, 13)}
REQUIRED_HARD_GATES = {"section_replacement","vocal_identity","pt_br_prosody","continuity","artifact_rate"}
GENERATION_TESTS = {"B01", "B05"}
EDIT_REFERENCE_TESTS = REQUIRED_TEST_IDS - GENERATION_TESTS


def fail(message: str) -> None:
    raise SystemExit(f"BENCHMARK CONTRACT FAILED: {message}")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    data = load(MANIFEST)
    brief = load(GENERATION_BRIEF)
    reference = load(REFERENCE_ANALYSIS)

    if data.get("benchmark") != "PabloVoice Benchmark v1": fail("unexpected benchmark name")
    tests = data.get("tests", [])
    ids = {test.get("id") for test in tests}
    if ids != REQUIRED_TEST_IDS: fail(f"expected tests {sorted(REQUIRED_TEST_IDS)}, got {sorted(ids)}")
    if len(tests) != 12: fail("benchmark must contain exactly 12 tests")

    gates = data.get("hard_gates", {})
    if set(gates) != REQUIRED_HARD_GATES: fail("hard-gate set changed")
    for name, gate in gates.items():
        if not gate.get("required", False): fail(f"hard gate {name} is no longer required")
        if "min_score" in gate and not 0 <= gate["min_score"] <= 10: fail(f"invalid min_score for {name}")
        if "max_percent" in gate and not 0 <= gate["max_percent"] <= 100: fail(f"invalid max_percent for {name}")

    principles = data.get("principles", {})
    for key in ("same_inputs","frozen_runtime","blind_review","no_threshold_changes_after_run","section_edits_must_preserve_unedited_context"):
        if principles.get(key) is not True: fail(f"principle {key} must remain true")

    policy = data.get("result_policy", {})
    for key in ("winner_requires_all_hard_gates","overall_score_without_hard_gates_is_non_promotable","raw_outputs_must_be_retained","human_blind_review_required","automated_metrics_required_when_applicable"):
        if policy.get(key) is not True: fail(f"result policy {key} must remain true")

    if brief.get("purpose") != "generation_target": fail("frozen brief must be generation_target")
    if set(brief.get("scope_tests", [])) != GENERATION_TESTS: fail("generation brief scope changed")
    boundary = brief.get("semantic_boundary", {})
    for key in ("describes_reference_mix", "describes_reference_instrumental"):
        if boundary.get(key) is not False: fail(f"{key} must remain false")
    if boundary.get("bpm_key_and_target_duration_are_generation_targets_only") is not True:
        fail("generation BPM/key/duration semantic boundary removed")

    if reference.get("purpose") != "edit_reference": fail("reference analysis must be edit_reference")
    if set(reference.get("scope_tests", [])) != EDIT_REFERENCE_TESTS: fail("edit-reference scope changed")
    coherence = reference.get("coherence_rule", {})
    for key in (
        "generation_brief_is_not_reference_metadata",
        "edit_tests_must_not_inherit_generation_bpm",
        "edit_tests_must_not_inherit_generation_key",
        "edit_tests_must_not_inherit_generation_target_duration",
        "correction_made_before_first_provider_output",
    ):
        if coherence.get(key) is not True: fail(f"coherence rule {key} must remain true")

    domains = data.get("input_domains", {})
    if set(domains) != {"generation_target", "edit_reference"}: fail("unexpected input domain set")
    if set(domains["generation_target"].get("tests", [])) != GENERATION_TESTS: fail("generation domain test set changed")
    if set(domains["edit_reference"].get("tests", [])) != EDIT_REFERENCE_TESTS: fail("edit-reference domain test set changed")

    by_id = {test["id"]: test for test in tests}
    for test_id in GENERATION_TESTS:
        if by_id[test_id].get("input_domain") != "generation_target": fail(f"{test_id} must use generation_target")
    for test_id in EDIT_REFERENCE_TESTS:
        if by_id[test_id].get("input_domain") != "edit_reference": fail(f"{test_id} must use edit_reference")

    frozen = reference.get("frozen_reference", {})
    if frozen.get("duration_seconds") != 184.96: fail("frozen edit-reference duration changed")
    if reference.get("key", {}).get("status") != "unresolved_not_gate": fail("low-confidence key must not become a gate")
    if reference.get("tempo", {}).get("status") != "supporting_observation_not_gate": fail("supporting tempo must not become a gate")

    print("BENCHMARK CONTRACT PASSED")
    print("12 tests locked; hard gates locked; generation/edit input domains coherent; anti-goalpost rules active.")


if __name__ == "__main__":
    main()
