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

    missing_hashes = []
    missing_runtime_assets = []
    for key in REQUIRED:
        asset = assets.get(key, {})
        if not asset.get("sha256"):
            missing_hashes.append(key)
        if not asset.get("asset_id") or asset.get("runtime_addressable") is not True:
            missing_runtime_assets.append(key)

    ready = (
        not missing_hashes
        and not missing_runtime_assets
        and data.get("gate", {}).get("acoustic_benchmark_runnable") is True
    )

    if ready:
        print("ACOUSTIC BENCHMARK READY")
        return

    print("ACOUSTIC BENCHMARK BLOCKED")
    if missing_hashes:
        print("Missing or unfrozen SHA-256: " + ", ".join(missing_hashes))
    if missing_runtime_assets:
        print("Missing runtime-addressable asset: " + ", ".join(missing_runtime_assets))
    if data.get("gate", {}).get("acoustic_benchmark_runnable") is not True:
        print("Manifest acoustic_benchmark_runnable flag is not true")

    if args.require_ready:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
