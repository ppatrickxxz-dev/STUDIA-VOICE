import json
from pathlib import Path

MANIFEST = Path(__file__).with_name("pablovoice-benchmark-v1.json")

REQUIRED_TEST_IDS = {f"B{i:02d}" for i in range(1, 13)}
REQUIRED_HARD_GATES = {
    "section_replacement",
    "vocal_identity",
    "pt_br_prosody",
    "continuity",
    "artifact_rate",
}


def fail(message: str) -> None:
    raise SystemExit(f"BENCHMARK CONTRACT FAILED: {message}")


def main() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))

    if data.get("benchmark") != "PabloVoice Benchmark v1":
        fail("unexpected benchmark name")

    tests = data.get("tests", [])
    ids = {test.get("id") for test in tests}
    if ids != REQUIRED_TEST_IDS:
        fail(f"expected tests {sorted(REQUIRED_TEST_IDS)}, got {sorted(ids)}")

    if len(tests) != 12:
        fail("benchmark must contain exactly 12 tests")

    gates = data.get("hard_gates", {})
    if set(gates) != REQUIRED_HARD_GATES:
        fail("hard-gate set changed")

    for name, gate in gates.items():
        if not gate.get("required", False):
            fail(f"hard gate {name} is no longer required")
        if "min_score" in gate and not 0 <= gate["min_score"] <= 10:
            fail(f"invalid min_score for {name}")
        if "max_percent" in gate and not 0 <= gate["max_percent"] <= 100:
            fail(f"invalid max_percent for {name}")

    principles = data.get("principles", {})
    for key in (
        "same_inputs",
        "frozen_runtime",
        "blind_review",
        "no_threshold_changes_after_run",
        "section_edits_must_preserve_unedited_context",
    ):
        if principles.get(key) is not True:
            fail(f"principle {key} must remain true")

    policy = data.get("result_policy", {})
    for key in (
        "winner_requires_all_hard_gates",
        "overall_score_without_hard_gates_is_non_promotable",
        "raw_outputs_must_be_retained",
        "human_blind_review_required",
        "automated_metrics_required_when_applicable",
    ):
        if policy.get(key) is not True:
            fail(f"result policy {key} must remain true")

    print("BENCHMARK CONTRACT PASSED")
    print("12 tests locked; hard gates locked; anti-goalpost rules active.")


if __name__ == "__main__":
    main()
