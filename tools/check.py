#!/usr/bin/env python3
"""Check every prompt file against the house style. Reports problems by file id.

Usage: python3 tools/check.py [--exclude FILE]
  --exclude FILE   a text file of prompts (one per line) that must not be repeated in the deck.
Exit status 1 if any problem is found.
"""
import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"

TYPES = {"premise", "character", "twisted-role", "reframe", "status-flip", "emotion-swap",
         "point-of-view", "origin", "mismatch"}
STATUSES = {"draft", "approved", "retired"}
MODIFIER_KINDS = {"speech", "tempo", "tone", "physical"}
MAX_WORDS = {1: 14, 2: 18}
# Every escalation has six steps; the host decides how far to take it.
ESCALATION_STEPS = 6
NEAR_DUP = 0.75
# Per language: words that would ask a performer to sing.
NO_SINGING = {
    "en": re.compile(r"\b(sing|sings|singing|sung|song|songs|ballad|opera|rap|rapping|lyrics|choir)\b", re.I),
}


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower())


def similar(a, b):
    """Near-duplicate test. For prompts of three words or fewer, spelling similarity is noise
    ("Cold." vs "Old."), so only an exact repeat counts."""
    a, b = norm(a), norm(b)
    if len(a.split()) <= 3 and len(b.split()) <= 3:
        return a == b
    return SequenceMatcher(None, a, b).ratio() >= NEAR_DUP


def load():
    out = []
    for f in sorted(PROMPTS.glob("*/*.json")):
        try:
            out.append((f.parent.name, f.stem, json.loads(f.read_text())))
        except json.JSONDecodeError as e:
            out.append((f.parent.name, f.stem, {"_error": str(e)}))
    return out


def texts(folder, p):
    """Every English string a performer may see for this entry."""
    if folder == "escalations":
        return [s.get("en", "") for s in p.get("steps", [])]
    return [p.get("text", {}).get("en", "")]


def check(entries, exclude):
    problems = []
    seen_ids = {}
    for folder, stem, p in entries:
        where = f"{folder}/{stem}"
        if "_error" in p:
            problems.append(f"{where}: invalid JSON ({p['_error']})")
            continue
        if p.get("id") != stem:
            problems.append(f"{where}: id does not match file name")
        if p.get("id") in seen_ids:
            problems.append(f"{where}: duplicate id (also {seen_ids[p['id']]})")
        seen_ids[p.get("id")] = where
        if p.get("status") not in STATUSES:
            problems.append(f"{where}: status must be one of {sorted(STATUSES)}")

        if folder == "modifiers":
            if p.get("kind") not in MODIFIER_KINDS:
                problems.append(f"{where}: kind must be one of {sorted(MODIFIER_KINDS)}")
        else:
            if p.get("players") not in (1, 2):
                problems.append(f"{where}: players must be 1 or 2")
            expected = {"solo": 1, "duo": 2}.get(folder)
            if expected and p.get("players") != expected:
                problems.append(f"{where}: players does not match the {folder} folder")

        if folder in ("solo", "duo"):
            if p.get("type") not in TYPES:
                problems.append(f"{where}: unknown type")
            if p.get("players") in MAX_WORDS and len(texts(folder, p)[0].split()) > MAX_WORDS[p["players"]]:
                problems.append(f"{where}: too long (max {MAX_WORDS[p['players']]} words)")
            cb = p.get("callback", {}).get("en")
            if cb is not None and not cb.startswith("the "):
                problems.append(f"{where}: callback phrase should be a short 'the …' noun phrase")
        if folder == "escalations":
            if len(p.get("steps", [])) != ESCALATION_STEPS:
                problems.append(f"{where}: an escalation has exactly {ESCALATION_STEPS} steps")
        if folder == "callbacks":
            if texts(folder, p)[0].count("{character}") != 1:
                problems.append(f"{where}: needs exactly one {{character}}")
        elif any("{" in t or "}" in t for t in texts(folder, p)):
            problems.append(f"{where}: placeholder outside a callback prompt")

        for lang, pattern in NO_SINGING.items():
            for t in texts(folder, p):
                if pattern.search(t):
                    problems.append(f"{where}: asks for singing ({lang})")

    # Duplicates: openers and single prompts only; callback frames and modifiers share shapes by design.
    pool = [(f"{f}/{s}", texts(f, p)[0]) for f, s, p in entries
            if "_error" not in p and f in ("solo", "duo", "escalations")]
    for i in range(len(pool)):
        for j in range(i + 1, len(pool)):
            if similar(pool[i][1], pool[j][1]):
                problems.append(f"{pool[i][0]} / {pool[j][0]}: near-duplicates")
        for x in exclude:
            if similar(pool[i][1], x):
                problems.append(f"{pool[i][0]}: repeats an excluded prompt")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exclude", type=Path)
    args = ap.parse_args()
    exclude = []
    if args.exclude:
        exclude = [l for l in args.exclude.read_text().splitlines() if l and not l.startswith("#")]
    entries = load()
    problems = check(entries, exclude)
    by_folder = {}
    for f, _, p in entries:
        by_folder.setdefault(f, {}).setdefault(p.get("status", "?"), 0)
        by_folder[f][p.get("status", "?")] += 1
    for f in sorted(by_folder):
        print(f"{f:12} " + ", ".join(f"{n} {s}" for s, n in sorted(by_folder[f].items())))
    print(f"{len(problems)} problem(s)")
    for line in problems:
        print("  " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
