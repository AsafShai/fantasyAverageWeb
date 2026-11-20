"""Diff two golden runs (golden/run.py outputs).

Rules (the migration's acceptance criteria):
  * strings, ids, bools, nulls, list lengths and ORDER, dict keys: exact;
  * numbers: exact, except a float may differ by at most 1e-9 relative
    (summation-order noise). Response values are already rounded by the API,
    so any difference that survives rounding is far above 1e-9 and fails;
  * an int on one side and an equal-valued float on the other is reported as a
    representation difference (identical once parsed by the browser's JSON);
  * model dumps store floats as hex strings, so they must match bit for bit.

    PYTHONPATH=. uv run python -m golden.compare golden/_data/before golden/_data/after \
        [--report golden/results/golden_compare.md]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

REL_TOL = 1e-9
SKIP_FILES = {"meta.json"}
# Fields that differ between two runs of the SAME code (verified with two
# "before" runs): a wall-clock duration, and a Postgres NOW() timestamp that the
# frozen Python clock cannot pin.
VOLATILE_KEYS = {"elapsed_ms", "computed_at"}


class Diff:
    def __init__(self):
        self.failures: list[str] = []
        self.tolerated: list[tuple[str, float, float, float]] = []
        self.repr_only: list[str] = []
        self.files = 0
        self.values = 0


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _cmp(a, b, path: str, d: Diff) -> None:
    d.values += 1
    if _num(a) and _num(b):
        if type(a) is not type(b):
            if float(a) == float(b):
                d.repr_only.append(f"{path}: {a!r} vs {b!r}")
            else:
                _cmp_float(float(a), float(b), path, d)
            return
        if isinstance(a, int):
            if a != b:
                d.failures.append(f"{path}: {a!r} != {b!r}")
            return
        _cmp_float(a, b, path, d)
        return
    if type(a) is not type(b):
        d.failures.append(f"{path}: type {type(a).__name__} {a!r:.80} != {type(b).__name__} {b!r:.80}")
        return
    if isinstance(a, dict):
        ka, kb = list(a.keys()), list(b.keys())
        if ka != kb:
            if set(ka) != set(kb):
                d.failures.append(f"{path}: keys differ: only-before={sorted(set(ka) - set(kb))[:10]} "
                                  f"only-after={sorted(set(kb) - set(ka))[:10]}")
                return
            d.failures.append(f"{path}: key order differs")
        for k in ka:
            if k in VOLATILE_KEYS:
                continue
            _cmp(a[k], b[k], f"{path}.{k}", d)
        return
    if isinstance(a, list):
        if len(a) != len(b):
            d.failures.append(f"{path}: length {len(a)} != {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            _cmp(x, y, f"{path}[{i}]", d)
        return
    if a != b:
        d.failures.append(f"{path}: {a!r:.120} != {b!r:.120}")


def _cmp_float(a: float, b: float, path: str, d: Diff) -> None:
    if a == b or (math.isnan(a) and math.isnan(b)):
        return
    rel = abs(a - b) / max(abs(a), abs(b))
    if rel <= REL_TOL:
        d.tolerated.append((path, a, b, rel))
    else:
        d.failures.append(f"{path}: {a!r} != {b!r} (rel {rel:.2e})")


def compare(before: Path, after: Path) -> tuple[Diff, dict]:
    d = Diff()
    per_area: dict[str, dict] = {}
    fa = {p.relative_to(before) for p in before.rglob("*.json")}
    fb = {p.relative_to(after) for p in after.rglob("*.json")}
    for rel in sorted(fa | fb):
        if rel.name in SKIP_FILES:
            continue
        area = rel.parts[0] if len(rel.parts) > 1 else "top"
        if len(rel.parts) > 2 and rel.parts[0] == "endpoints":
            area = f"endpoints/{rel.parts[1]}"
        stats = per_area.setdefault(area, {"files": 0, "failures": 0, "tolerated": 0, "repr_only": 0})
        stats["files"] += 1
        d.files += 1
        if rel not in fa or rel not in fb:
            d.failures.append(f"{rel}: missing in {'before' if rel not in fa else 'after'}")
            stats["failures"] += 1
            continue
        nf, nt, nr = len(d.failures), len(d.tolerated), len(d.repr_only)
        _cmp(json.loads((before / rel).read_text()), json.loads((after / rel).read_text()), str(rel), d)
        stats["failures"] += len(d.failures) - nf
        stats["tolerated"] += len(d.tolerated) - nt
        stats["repr_only"] += len(d.repr_only) - nr
    # tape misses must match too (same requests made, same ones unanswered)
    ma = json.loads((before / "meta.json").read_text()) if (before / "meta.json").exists() else {}
    mb = json.loads((after / "meta.json").read_text()) if (after / "meta.json").exists() else {}
    if ma.get("tape_misses") != mb.get("tape_misses"):
        d.failures.append(f"meta.tape_misses differ: {ma.get('tape_misses')} vs {mb.get('tape_misses')}")
    return d, per_area


def report(d: Diff, per_area: dict, before: Path, after: Path) -> str:
    lines = [f"# Golden comparison: `{before.name}` vs `{after.name}`", ""]
    lines.append(f"Files compared: {d.files}; values compared: {d.values}")
    lines.append(f"Ignored volatile keys (differ between two runs of the same code): {sorted(VOLATILE_KEYS)}")
    lines.append(f"Failures: **{len(d.failures)}**; tolerated float differences (<= {REL_TOL:g} rel): "
                 f"**{len(d.tolerated)}**; int/float representation-only: **{len(d.repr_only)}**")
    lines += ["", "| area | files | failures | tolerated | repr-only |", "|---|---:|---:|---:|---:|"]
    for area, s in sorted(per_area.items()):
        lines.append(f"| {area} | {s['files']} | {s['failures']} | {s['tolerated']} | {s['repr_only']} |")
    if d.failures:
        lines += ["", "## Failures (first 200)", ""] + [f"- `{f}`" for f in d.failures[:200]]
    if d.tolerated:
        lines += ["", "## Tolerated float differences", "",
                  "| path | before | after | rel |", "|---|---|---|---|"]
        lines += [f"| `{p}` | {a!r} | {b!r} | {r:.1e} |" for p, a, b, r in d.tolerated[:500]]
    if d.repr_only:
        lines += ["", "## int/float representation only (first 100)", ""] + [f"- `{x}`" for x in d.repr_only[:100]]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--report")
    args = ap.parse_args()
    before, after = Path(args.before), Path(args.after)
    d, per_area = compare(before, after)
    text = report(d, per_area, before, after)
    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(text)
    print(text[:6000])
    sys.exit(1 if d.failures else 0)


if __name__ == "__main__":
    main()
