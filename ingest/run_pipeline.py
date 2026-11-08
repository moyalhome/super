"""Daily pipeline: find stores near home, download today's prices, build the web data files.

usage: python run_pipeline.py <out_dir>
env:   HOME_ADDRESS (required, never committed), RADIUS_KM (default 4)

The vendored plugin scripts have no retry logic and some portals are slow (Shufersal takes ~40s),
so each step is repeated a few times. Results are cached per day, so retries only redo what failed.
"""
import os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
PY = sys.executable


def run(args, label, quiet=False):
    """quiet: do not echo stdout. Used for find_stores, whose output has exact distances from home
    and the logs of a public repository are public."""
    print(f"\n=== {label} ===", flush=True)
    r = subprocess.run([PY, *args], cwd=HERE, capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if quiet:
        tail = [l for l in r.stdout.splitlines() if " stores within " in l]
        print(tail[-1].split(" -> ")[0] if tail else "(no summary line)")
    else:
        sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    return r


def main():
    # absolute, because the child scripts run with this folder as their working directory
    out = str(Path(sys.argv[1]).resolve())
    address = os.environ.get("HOME_ADDRESS")
    if not address:
        sys.exit("HOME_ADDRESS is not set")
    radius = os.environ.get("RADIUS_KM", "4")

    # 1. stores: retry while a portal was skipped ("warning: skipping <chain>")
    for attempt in range(1, 4):
        r = run(["find_stores.py", address, "--radius", radius], f"find stores (attempt {attempt})", quiet=True)
        if r.returncode != 0:
            sys.exit("find_stores failed (details hidden: they may contain the home address)")
        if "warning: skipping" not in r.stderr:
            break
    else:
        print("some portals could not be reached; continuing with the rest", file=sys.stderr)

    # 2. prices for every branch in range (10 per banner covers them all at this radius)
    for attempt in range(1, 4):
        r = run(["prices.py", "--nearby", "10"], f"download prices (attempt {attempt})")
        fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL") and "no PriceFull" not in l]
        if not fails:
            break

    # 3. compact JSON for the app
    r = run(["build_data.py", out], "build data files")
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
