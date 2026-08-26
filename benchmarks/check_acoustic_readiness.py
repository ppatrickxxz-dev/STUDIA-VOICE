import argparse
import json
from pathlib import Path

MANIFEST = Path(__file__).parent / "assets" / "binary-reference-manifest.json"

REQUIRED = (
    "vocal_provider_input",
    "reference_mix",
    "reference_instrumental",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()

    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assets = data.get("assets", {})

    missing = []
    for key in REQUIRED:
        asset = assets.get(key, {})
        if not asset.get("sha256"):
            missing.append(key)

    ready = not missing and data.get("gate", {}).get("acoustic_benchmark_runnable") is True

    if ready:
        print("ACOUSTIC BENCHMARK READY")
        return

    print("ACOUSTIC BENCHMARK BLOCKED")
    print("Missing or unfrozen assets: " + ", ".join(missing or ["gate flag"]))

    if args.require_ready:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
