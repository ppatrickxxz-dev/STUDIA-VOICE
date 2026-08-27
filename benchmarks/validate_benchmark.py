import json
from pathlib import Path

ROOT = Path(__file__).parent
MANIFEST = ROOT / "pablovoice-benchmark-v1.json"
GENERATION_BRIEF = ROOT / "assets" / "frozen-brief.json"
REFERENCE_ANALYSIS = ROOT / "assets" / "reference-analysis.json"
NATURAL_LANGUAGE_EDITS = ROOT / "assets" / "natural-language-edits.json"
SEQUENTIAL_EDITS = ROOT / "assets" / "sequential-edits.json"
HARMONY_GENERATION = ROOT / "assets" / "harmony-generation.json"

REQUIRED_TEST_IDS = {f"B{i:02d}" for i in range(1, 13)}
REQUIRED_HARD_GATES = {"section_replacement","vocal_identity","pt_br_prosody","continuity","artifact_rate"}
GENERATION_TESTS = {"B01", "B05"}
EDIT_REFERENCE_TESTS = REQUIRED_TEST_IDS - GENERATION_TESTS
B10_FROZEN_COMMAND = "Deixa minha voz mais limpa e presente, centraliza ela e coloca um fade bem curto no começo, sem mexer no fim."
B10_EXPECTED_OPERATIONS = [
    {"type": "set_effect", "key": "clean", "value": True},
    {"type": "set_effect", "key": "presence", "value": True},
    {"type": "set_track", "key": "pan", "value": 0},
    {"type": "set_effect", "key": "fadeIn", "value": 0.25},
]
B11_FROZEN_COMMANDS = [
    "Deixa minha voz mais limpa, sem mexer no fim.",
    "Deixa ela mais presente e centraliza.",
    "Coloca um fade bem curto no começo, sem mexer no fim.",
]
B11_EXPECTED_STEP_OPERATIONS = [
    [{"type": "set_effect", "key": "clean", "value": True}],
    [
        {"type": "set_effect", "key": "presence", "value": True},
        {"type": "set_track", "key": "pan", "value": 0},
    ],
    [{"type": "set_effect", "key": "fadeIn", "value": 0.25}],
]
B11_REQUIRED_PRESERVATIONS = {
    "project identity",
    "lyrics",
    "track order",
    "non-selected tracks",
    "selected source asset identity",
    "selected duration/sample-rate/channel layout",
    "selected offset/trim/gain/mute/solo",
}
B07_FROZEN_LAYERS = [
    {"voice": "high", "mode": "adaptive_partial"},
    {"voice": "low", "mode": "adaptive_partial"},
]
B07_DEPLOYED_FUNCTION_SHA256 = "b4dcc26669395ee4c9f07b8d525cf81805b2b6d75bbe7ab8a6a8a0134551def1"


def fail(message: str) -> None:
    raise SystemExit(f"BENCHMARK CONTRACT FAILED: {message}")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    data = load(MANIFEST)
    brief = load(GENERATION_BRIEF)
    reference = load(REFERENCE_ANALYSIS)
    conversational = load(NATURAL_LANGUAGE_EDITS)
    sequential = load(SEQUENTIAL_EDITS)
    harmony = load(HARMONY_GENERATION)

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

    if conversational.get("purpose") != "B10 conversational edit execution": fail("B10 conversational purpose changed")
    if conversational.get("frozen_before_first_provider_output") is not True: fail("B10 case must remain frozen pre-output")
    cases = conversational.get("cases", [])
    if len(cases) != 1: fail("B10 v1 must contain exactly one frozen conversational case")
    case = cases[0]
    if case.get("id") != "B10_C1_ptbr_local_voice_edit": fail("B10 frozen case id changed")
    if case.get("language") != "pt-BR": fail("B10 frozen case language changed")
    if case.get("command") != B10_FROZEN_COMMAND: fail("B10 frozen command changed")
    if case.get("expected_operations") != B10_EXPECTED_OPERATIONS: fail("B10 expected operations changed")
    if set(case.get("must_preserve", [])) != {"trimEnd", "fadeOut"}: fail("B10 preservation contract changed")
    if case.get("must_not_require_daw_terms") is not True: fail("B10 must remain conversational/non-DAW")
    if case.get("unsupported_extra_actions_are_failure") is not True: fail("B10 fail-closed rule changed")

    if sequential.get("purpose") != "B11 continuity under repeated edits": fail("B11 purpose changed")
    if sequential.get("frozen_before_first_provider_output") is not True: fail("B11 sequence must remain frozen pre-output")
    if sequential.get("target") != "active_vocal_track": fail("B11 target changed")
    if sequential.get("commands") != B11_FROZEN_COMMANDS: fail("B11 frozen command sequence changed")
    if sequential.get("expected_step_operations") != B11_EXPECTED_STEP_OPERATIONS: fail("B11 expected operations changed")
    if set(sequential.get("must_preserve_across_all_steps", [])) != B11_REQUIRED_PRESERVATIONS: fail("B11 preservation contract changed")
    if sequential.get("score_requires_acoustic_evidence") is not True: fail("B11 must require acoustic evidence before scoring")
    if sequential.get("implementation_readiness_is_not_pass") is not True: fail("B11 readiness must not become a pass")

    if harmony.get("purpose") != "B07 harmony generation execution plan": fail("B07 purpose changed")
    if harmony.get("frozen_before_first_b07_benchmark_output") is not True: fail("B07 plan must remain frozen pre-output")
    if harmony.get("input_domain") != "edit_reference": fail("B07 must use edit_reference")
    if harmony.get("layers") != B07_FROZEN_LAYERS: fail("B07 high/low layer plan changed")
    req = harmony.get("requirements", {})
    for key in ("both_layers_required", "timing_alignment_required", "formant_preservation_required", "lead_must_remain_unmodified", "discreet_blend_required", "unsupported_or_missing_layer_is_non_promotable"):
        if req.get(key) is not True: fail(f"B07 requirement {key} must remain true")
    route = harmony.get("route_evidence", {})
    if route.get("deployed_function_sha256") != B07_DEPLOYED_FUNCTION_SHA256: fail("B07 deployed function evidence changed")
    for key in ("supports_high", "supports_low", "supports_formant_preservation"):
        if route.get(key) is not True: fail(f"B07 route capability {key} removed")
    observed = harmony.get("observed_execution", {})
    if observed.get("high", {}).get("verified") is not True: fail("B07 high observed execution must remain verified")
    if observed.get("low") is not None: fail("B07 low must remain unvalidated until a real retained execution exists")

    print("BENCHMARK CONTRACT PASSED")
    print("12 tests locked; hard gates locked; B07/B10/B11 plans frozen; anti-goalpost rules active.")


if __name__ == "__main__":
    main()
