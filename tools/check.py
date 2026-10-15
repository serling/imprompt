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
# Shared word lists (locations, occupations, emotions …), drawn on by every mode. words/tags.json
# lists the kinds and the tags each kind may carry.
WORDS = ROOT / "words"
SCHEMA = json.loads((WORDS / "tags.json").read_text())
# Short-form games: reusable frames, one file per game. Their suggestions come from the words.
GAMES = ROOT / "games"
GAME_FAMILIES = {"rule", "host-calls", "elimination", "replay", "tag-out", "guessing", "word-story",
                 "physical", "other"}
GAME_LIMITS = {"name": 5, "summary": 16, "step": 22, "more": 40}
# A tag names one value on one axis, so a word's flat tag list can't be read two ways.
_seen = [v for ax in SCHEMA["axes"].values() for v in ax["values"]]
assert len(_seen) == len(set(_seen)), "words/tags.json: a tag name is used on two axes"
# Kind, axis and tag names are ids; what a person reads is keyed by language, like every text.
_texts = [k["label"] for k in SCHEMA["kinds"].values()]
_texts += [ax[f] for ax in SCHEMA["axes"].values() for f in ("label", "about")]
_texts += [v[f] for ax in SCHEMA["axes"].values() for v in ax["values"].values() for f in ("label", "about")]
assert all(isinstance(t, dict) and t.get("en") for t in _texts), "words/tags.json: a label or about without \"en\""

TYPES = {"premise", "character", "twisted-role", "reframe", "status-flip", "emotion-swap",
         "point-of-view", "origin", "mismatch"}
STATUSES = {"draft", "approved", "retired"}
MAX_WORDS = {1: 14, 2: 18}
MAX_SCENE_WORDS = 20
# Words may recur by design, so they are not checked against prompts or the exclusion list.
VOCABULARY = set(SCHEMA["kinds"])
# Every escalation has four steps: base, more, even more, then a twist. The host decides how far to go.
ESCALATION_STEPS = 4
NEAR_DUP = 0.75
# Per language: words that would ask a performer to sing.
NO_SINGING = {
    "en": re.compile(r"\b(sing|sings|singing|sung|song|songs|ballad|opera|rap|rapping|lyrics|choir)\b", re.I),
}


# Per language: things that don't travel. American-only institutions and customs, and brands
# (a prompt or word must work without a reference, and outlive one).
NOT_LOCAL = {
    "en": re.compile(r"\b(prom|homecoming|frat|fraternity|sorority|dmv|thanksgiving|fourth of july|"
                     r"super bowl|high school|sheriff|county fair|yard sale|mall|quarterback|baseball|"
                     r"cheerleaders?|walmart|mcdonald'?s|starbucks|ikea|coca-cola|google|tesla|"
                     r"netflix|tiktok|instagram|facebook|uber|lego)\b", re.I),
}
# Per language: words that ask a player to keep something from their scene partner, so the
# scene is played at the audience instead of with each other ("secretly competitive" is just
# "competitive"). Hiding something together, or telling a secret, is fine.
NO_HIDING = {
    "en": re.compile(r"\b(secretly|hiding [^.]*\bsecrets?)\b", re.I),
}
# Per language: sport words. Sport is seasoning; the balance report counts its share.
SPORT = {
    "en": re.compile(r"\b(football|soccer|rugby|tennis|golf|ski|skiing|hockey|boxing|referee|"
                     r"stadium|athlete|marathon|cricket|basketball|bowling|swimming|ice rink)\b", re.I),
}
# Balance limits for a word list: warnings, not failures. A domain may lead (family
# relationships are mostly "home"), but not crowd out the rest.
MAX_UNUSUAL = 0.2
MAX_SPORT = 0.06
MAX_DOMAIN = 0.4


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower())


def word_key(s):
    """Two words that differ only by an article, a plural or a possessive are the same word
    ("Cousin" / "Cousins", "Barber" / "Barber's")."""
    toks = norm(s.replace("'", "")).split()
    while toks and toks[0] in ("a", "an", "the"):
        toks = toks[1:]
    return " ".join(t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t for t in toks)


def similar(a, b):
    """Near-duplicate test. For prompts of three words or fewer, spelling similarity is noise
    ("Cold." vs "Old."), so only an exact repeat counts."""
    a, b = norm(a), norm(b)
    if len(a.split()) <= 3 and len(b.split()) <= 3:
        return a == b
    return SequenceMatcher(None, a, b).ratio() >= NEAR_DUP


def load():
    out = []
    for f in sorted(PROMPTS.glob("*/*.json")) + sorted(WORDS.glob("*/*.json")) + sorted(GAMES.glob("*.json")):
        try:
            out.append((f.parent.name, f.stem, json.loads(f.read_text())))
        except json.JSONDecodeError as e:
            out.append((f.parent.name, f.stem, {"_error": str(e)}))
    return out


def texts(folder, p):
    """Every English string a performer may see for this entry."""
    if folder == "escalations":
        return [s.get("en", "") for s in p.get("steps", [])]
    if folder == "games":
        en = lambda f: p.get(f, {}).get("en", "")
        return [en("name"), en("summary"), *(en("steps") or []), en("more"), *(en("aliases") or [])]
    return [p.get("text", {}).get("en", "")]


def check_word(where, kind, p):
    problems = []
    rules = SCHEMA["kinds"][kind]
    if len(texts(kind, p)[0].split()) > rules["max_words"]:
        problems.append(f"{where}: too long (max {rules['max_words']} words)")
    tags = p.get("tags", [])
    if not rules["tagged"]:
        if tags:
            problems.append(f"{where}: {kind} carry no tags yet")
        return problems
    axes = {a: ax for a, ax in SCHEMA["axes"].items() if kind in ax["kinds"]}
    known = {v: a for a, ax in axes.items() for v in ax["values"]}
    for t in tags:
        if t not in known:
            problems.append(f"{where}: unknown tag '{t}' for {kind}")
    if len(set(tags)) != len(tags):
        problems.append(f"{where}: a tag given twice")
    for a, ax in axes.items():
        n = sum(1 for t in tags if known.get(t) == a)
        if not ax["min"] <= n <= ax["max"]:
            problems.append(f"{where}: needs {ax['min']}–{ax['max']} '{a}' tag(s), has {n}")
    return problems


def check_game(where, p):
    problems = []
    for f in ("name", "summary", "more"):
        t = p.get(f, {}).get("en")
        if not isinstance(t, str) or not t:
            problems.append(f"{where}: needs an English {f}")
        elif len(t.split()) > GAME_LIMITS[f]:
            problems.append(f"{where}: {f} too long (max {GAME_LIMITS[f]} words)")
    steps = p.get("steps", {}).get("en")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 4:
        problems.append(f"{where}: one to four English steps")
    else:
        for i, t in enumerate(steps, 1):
            if len(t.split()) > GAME_LIMITS["step"]:
                problems.append(f"{where}: step {i} too long (max {GAME_LIMITS['step']} words)")
    if not isinstance(p.get("aliases", {}).get("en"), list):
        problems.append(f"{where}: aliases must be a list (may be empty)")
    if p.get("family") not in GAME_FAMILIES:
        problems.append(f"{where}: family must be one of {sorted(GAME_FAMILIES)}")
    pl = p.get("players", {})
    if not (isinstance(pl.get("min"), int) and isinstance(pl.get("max"), int) and 1 <= pl["min"] <= pl["max"]):
        problems.append(f"{where}: players needs min <= max")
    for k in p.get("asks", []):
        if k not in SCHEMA["kinds"]:
            problems.append(f"{where}: asks for an unknown word kind '{k}'")
    return problems


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

        if folder == "scenes":
            if p.get("players") not in (2, 3, 4):
                problems.append(f"{where}: a scene has 2, 3 or 4 players")
            if len(texts(folder, p)[0].split()) > MAX_SCENE_WORDS:
                problems.append(f"{where}: too long (max {MAX_SCENE_WORDS} words)")
        elif folder in VOCABULARY:
            problems += check_word(where, folder, p)
        elif folder == "games":
            problems += check_game(where, p)
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
        if p.get("status") != "retired":
            for lang, pattern in NO_HIDING.items():
                for t in texts(folder, p):
                    if pattern.search(t):
                        problems.append(f"{where}: hides something from a scene partner ({lang})")
            for lang, pattern in NOT_LOCAL.items():
                for t in texts(folder, p):
                    if m := pattern.search(t):
                        problems.append(f"{where}: won't travel: '{m.group(0)}' ({lang})")

    words = {}
    for f, s, p in entries:
        if f in VOCABULARY and "_error" not in p and p.get("status") != "retired":
            key = (f, word_key(texts(f, p)[0]))
            if key in words:
                problems.append(f"{f}/{s} / {words[key]}: the same word twice")
            words[key] = f"{f}/{s}"

    # Duplicates: openers and single prompts only; callback frames share shapes by design.
    # Retired prompts never play, so only playable ones are checked against the exclusion list.
    pool = [(f"{f}/{s}", texts(f, p)[0], p.get("status") != "retired") for f, s, p in entries
            if "_error" not in p and f in ("solo", "duo", "escalations", "scenes")]
    for i in range(len(pool)):
        for j in range(i + 1, len(pool)):
            if similar(pool[i][1], pool[j][1]):
                problems.append(f"{pool[i][0]} / {pool[j][0]}: near-duplicates")
        for x in exclude if pool[i][2] else ():
            if similar(pool[i][1], x):
                problems.append(f"{pool[i][0]}: repeats an excluded prompt")
    return problems


def balance(entries):
    """Warnings for a word list that skews: too many unusual words, too much sport, one domain
    crowding out the rest. Lines, not failures: a batch can be fixed by adding to it."""
    lines, warnings = [], []
    for kind, rules in SCHEMA["kinds"].items():
        words = [p for f, _, p in entries if f == kind and "_error" not in p and p.get("status") != "retired"]
        if not words:
            continue
        n = len(words)
        sport = sum(1 for p in words if SPORT["en"].search(texts(kind, p)[0])) / n
        line = f"{kind:13} {n:4}  sport {sport:4.0%}"
        if sport > MAX_SPORT:
            warnings.append(f"{kind}: sport is {sport:.0%} (limit {MAX_SPORT:.0%})")
        if rules["tagged"]:
            unusual = sum(1 for p in words if "unusual" in p.get("tags", [])) / n
            line += f"  unusual {unusual:4.0%}"
            if unusual > MAX_UNUSUAL:
                warnings.append(f"{kind}: unusual is {unusual:.0%} (limit {MAX_UNUSUAL:.0%})")
            domains = {d: 0 for d in SCHEMA["axes"]["domain"]["values"]}
            for p in words:
                for t in p.get("tags", []):
                    if t in domains:
                        domains[t] += 1
            top = sorted(domains.items(), key=lambda x: -x[1])
            line += "  " + " ".join(f"{d} {c}" for d, c in top)
            for d, c in top:
                if c / n > MAX_DOMAIN:
                    warnings.append(f"{kind}: '{d}' is {c / n:.0%} of the list (limit {MAX_DOMAIN:.0%})")
        lines.append(line)
    return lines, warnings


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
    lines, warnings = balance(entries)
    print("\nWord balance")
    for line in lines:
        print("  " + line)
    for w in warnings:
        print("  warning: " + w)
    print(f"\n{len(problems)} problem(s)")
    for line in problems:
        print("  " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
