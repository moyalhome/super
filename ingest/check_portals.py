"""Reachability smoke test: can this machine download the store list from each price portal?

Prints one line per chain and a summary. Used from GitHub Actions to find out whether the portals
block GitHub's IP ranges. Prints no secrets and no personal data.
"""
import sys, time

from chains import all_chain_keys, stores_for

ATTEMPTS = 3


def check(chain):
    last = None
    for i in range(1, ATTEMPTS + 1):
        t = time.time()
        try:
            rows = stores_for(chain)
            return True, f"{len(rows)} stores in {time.time() - t:.1f}s (attempt {i})"
        except Exception as e:  # noqa: BLE001 - we want to report any failure
            last = f"{type(e).__name__}: {str(e)[:160]} (attempt {i}, {time.time() - t:.1f}s)"
            time.sleep(3)
    return False, last


def main():
    ok, bad = [], []
    for chain in all_chain_keys():
        good, info = check(chain)
        print(f'{"OK  " if good else "FAIL"} {chain:12} {info}', flush=True)
        (ok if good else bad).append(chain)
    print(f"\nreachable: {len(ok)}/{len(ok) + len(bad)}")
    if bad:
        print("failed:", ", ".join(bad))
    return 0


if __name__ == "__main__":
    sys.exit(main())
