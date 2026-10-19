#!/usr/bin/env python3
import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"
WORDS = ROOT / "words"
SCHEMA = json.loads((WORDS / "tags.json").read_text())
GAMES = ROOT / "games"
CONTENT = json.loads((ROOT / "schema" / "content.schema.json").read_text())
DEFS = CONTENT["$defs"]
SHAPE_OF = {"solo": "prompt", "duo": "prompt", "callbacks": "callback", "escalations": "escalation",
            "scenes": "scene", "games": "game"}
GAME_LIMITS = {"name": 5, "summary": 16, "step": 22, "more": 40}
_seen = [v for ax in SCHEMA["axes"].values() for v in ax["values"]]
assert len(_seen) == len(set(_seen)), "words/tags.json: a tag name is used on two axes"
_texts = [k["label"] for k in SCHEMA["kinds"].values()]
_texts += [ax[f] for ax in SCHEMA["axes"].values() for f in ("label", "about")]
_texts += [v[f] for ax in SCHEMA["axes"].values() for v in ax["values"].values() for f in ("label", "about")]
assert all(isinstance(t, dict) and t.get("en") for t in _texts), "words/tags.json: a label or about without \"en\""

SOLO_ONLY = {"series"}
DUO_ONLY = {"two-of-you"}
MAX_WORDS = {1: 14, 2: 18}
MAX_SCENE_WORDS = 20
VOCABULARY = set(SCHEMA["kinds"])
NEAR_DUP = 0.75
NO_SINGING = {
    "en": re.compile(r"\b(sing|sings|singing|sung|song|songs|ballad|opera|rap|rapping|lyrics|choir)\b", re.I),
}


NOT_LOCAL = {
    "en": re.compile(r"\b(prom|homecoming|frat|fraternity|sorority|dmv|thanksgiving|fourth of july|"
                     r"super bowl|high school|sheriff|county fair|yard sale|mall|quarterback|baseball|"
                     r"cheerleaders?|walmart|mcdonald'?s|starbucks|ikea|coca-cola|google|tesla|"
                     r"netflix|tiktok|instagram|facebook|uber|lego)\b", re.I),
}
NO_HIDING = {
    "en": re.compile(r"\b(secretly|hiding [^.]*\bsecrets?)\b", re.I),
}
SPORT = {
    "en": re.compile(r"\b(football|soccer|rugby|tennis|golf|ski|skiing|hockey|boxing|referee|"
                     r"stadium|athlete|marathon|cricket|basketball|bowling|swimming|ice rink)\b", re.I),
}
MAX_UNUSUAL = 0.35
MAX_SPORT = 0.06
MAX_DOMAIN = 0.4
WORLDS = set(DEFS["world"]["enum"])
WORLD_MIX = {"everyday": (0.60, 0.65), "fantastical": (0.15, 0.20), "other worlds": (0.15, 0.20)}
RAPID_WORLD_MIX = {"everyday": (0.50, 0.65), "fantastical": (0.15, 0.30), "other worlds": (0.15, 0.30)}
MAX_ONE_WORLD = 0.04
SHAPES = {
    "en": {
        "'like a …'": (re.compile(r"\blike (a|an|the|someone)\b", re.I), 0.12),
        "'[A] and [B] who …'": (re.compile(r"^(an?|the|two) [^,]+? and (an?|the|his|her|their|its) [^,]+? who\b", re.I), 0.25),
        "', but …'": (re.compile(r",? but\b", re.I), 0.05),
        "'the first …'": (re.compile(r"^(the|history's|the world's) (very )?first\b|\bvery first\b|\bfirst (ever|in history)\b", re.I), 0.05),
        "'Someone trying …'": (re.compile(r"^someone trying\b", re.I), 0.02),
        "'keeps …'": (re.compile(r"\bkeeps\b", re.I), 0.03),
    },
}
MAX_OPENING = 0.025
MAX_RECIPE = 0.15
MAX_STATUS_FLIP = 0.04


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower())


def word_key(s):
    toks = norm(s.replace("'", "")).split()
    while toks and toks[0] in ("a", "an", "the"):
        toks = toks[1:]
    return " ".join(t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t for t in toks)


def similar(a, b):
    a, b = norm(a), norm(b)
    if len(a.split()) <= 3 and len(b.split()) <= 3:
        return a == b
    return SequenceMatcher(None, a, b).ratio() >= NEAR_DUP


def resolve(ref):
    node = CONTENT
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    return node


def validate(v, s, path="file"):
    if "$ref" in s:
        s = {**resolve(s["$ref"]), **{k: x for k, x in s.items() if k != "$ref"}}
    errors = []
    for sub in s.get("allOf", []):
        errors += validate(v, sub, path)
    if "if" in s:
        branch = s.get("else") if validate(v, s["if"], path) else s.get("then")
        if branch:
            errors += validate(v, branch, path)
    kinds = {"object": dict, "array": list, "string": str, "integer": int}
    if "type" in s and (not isinstance(v, kinds[s["type"]]) or isinstance(v, bool)):
        return errors + [f"{path} must be {'an' if s['type'][0] in 'aeiou' else 'a'} {s['type']}"]
    if "const" in s and v != s["const"]:
        errors.append(f"{path} must be {s['const']!r}")
    if "enum" in s and v not in s["enum"]:
        errors.append(f"{path} must be one of {s['enum']}")
    if isinstance(v, str):
        if len(v) < s.get("minLength", 0):
            errors.append(f"{path} must not be empty")
        if "pattern" in s and not re.search(s["pattern"], v):
            errors.append(f"{path} has the wrong form")
    if isinstance(v, int) and not isinstance(v, bool) and v < s.get("minimum", v):
        errors.append(f"{path} must be at least {s['minimum']}")
    if isinstance(v, list):
        if len(v) < s.get("minItems", 0) or len(v) > s.get("maxItems", len(v)):
            errors.append(f"{path} needs {s.get('minItems', 0)}–{s.get('maxItems', 'any')} items")
        if "items" in s:
            for i, x in enumerate(v):
                errors += validate(x, s["items"], f"{path}[{i}]")
    if isinstance(v, dict):
        for k in s.get("required", []):
            if k not in v:
                errors.append(f"{path} needs '{k}'")
        props = s.get("properties", {})
        for k, x in v.items():
            if k in props:
                errors += validate(x, props[k], k if path == "file" else f"{path}.{k}")
            elif s.get("additionalProperties") is False:
                errors.append(f"{path} has an unknown field '{k}'")
    return errors


def load():
    out = []
    for f in sorted(PROMPTS.glob("*/*.json")) + sorted(WORDS.glob("*/*.json")) + sorted(GAMES.glob("*.json")):
        try:
            out.append((f.parent.name, f.stem, json.loads(f.read_text())))
        except json.JSONDecodeError as e:
            out.append((f.parent.name, f.stem, {"_error": str(e)}))
    return out


def texts(folder, p):
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
        if isinstance(t, str) and len(t.split()) > GAME_LIMITS[f]:
            problems.append(f"{where}: {f} too long (max {GAME_LIMITS[f]} words)")
    steps = p.get("steps", {}).get("en")
    for i, t in enumerate(steps if isinstance(steps, list) else [], 1):
        if isinstance(t, str) and len(t.split()) > GAME_LIMITS["step"]:
            problems.append(f"{where}: step {i} too long (max {GAME_LIMITS['step']} words)")
    pl = p.get("players", {})
    if isinstance(pl.get("min"), int) and isinstance(pl.get("max"), int) and pl["min"] > pl["max"]:
        problems.append(f"{where}: players needs min <= max")
    for k in p.get("asks", []):
        kind, _, narrow = k.partition(":")
        if kind not in SCHEMA["kinds"]:
            problems.append(f"{where}: asks for an unknown word kind '{kind}'")
            continue
        allowed = {v for ax in SCHEMA["axes"].values() if kind in ax["kinds"] for v in ax["values"]}
        for t in filter(None, narrow.split("+")):
            if t not in allowed:
                problems.append(f"{where}: asks for '{k}', but '{t}' is not a tag of {kind}")
    return problems


def check(entries, exclude, near_dups=False):
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
        problems += [f"{where}: {e}" for e in validate(p, DEFS[SHAPE_OF.get(folder, "word")])]

        if folder == "scenes":
            if len(texts(folder, p)[0].split()) > MAX_SCENE_WORDS:
                problems.append(f"{where}: too long (max {MAX_SCENE_WORDS} words)")
        elif folder in VOCABULARY:
            problems += check_word(where, folder, p)
        elif folder == "games":
            problems += check_game(where, p)
        else:
            expected = {"solo": 1, "duo": 2}.get(folder)
            if expected and p.get("players") != expected:
                problems.append(f"{where}: players does not match the {folder} folder")

        if folder in ("solo", "duo"):
            if p.get("type") in SOLO_ONLY and folder != "solo" or p.get("type") in DUO_ONLY and folder != "duo":
                problems.append(f"{where}: {p['type']} does not belong in {folder}")
            if p.get("players") in MAX_WORDS and len(texts(folder, p)[0].split()) > MAX_WORDS[p["players"]]:
                problems.append(f"{where}: too long (max {MAX_WORDS[p['players']]} words)")
        if folder != "callbacks" and any("{" in t or "}" in t for t in texts(folder, p)):
            problems.append(f"{where}: braces in a text")

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

    pool = [(f"{f}/{s}", texts(f, p)[0], p.get("status") != "retired") for f, s, p in entries
            if "_error" not in p and f in ("solo", "duo", "escalations", "scenes")]
    for i in range(len(pool)):
        for j in range(i + 1, len(pool)) if near_dups else ():
            if similar(pool[i][1], pool[j][1]):
                problems.append(f"{pool[i][0]} / {pool[j][0]}: near-duplicates")
        for x in exclude if pool[i][2] else ():
            if similar(pool[i][1], x):
                problems.append(f"{pool[i][0]}: repeats an excluded prompt")
    return problems


def balance(entries):
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
        covers = lambda axis: kind in SCHEMA["axes"][axis]["kinds"]
        if rules["tagged"] and covers("feel"):
            unusual = sum(1 for p in words if "unusual" in p.get("tags", [])) / n
            line += f"  unusual {unusual:4.0%}"
            if unusual > MAX_UNUSUAL:
                warnings.append(f"{kind}: unusual is {unusual:.0%} (limit {MAX_UNUSUAL:.0%})")
        if rules["tagged"] and not covers("domain"):
            for axis, ax in SCHEMA["axes"].items():
                if covers(axis):
                    counts = {v: sum(1 for p in words if v in p.get("tags", [])) for v in ax["values"]}
                    line += f"  {axis}: " + " ".join(f"{v} {c}" for v, c in counts.items())
        if rules["tagged"] and covers("domain"):
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


def world_mix(entries):
    lines, warnings = [], []
    for folder in ("solo", "duo", "scenes"):
        ws = [p.get("world") for f, _, p in entries
              if f == folder and "_error" not in p and p.get("status") != "retired"]
        if not ws:
            continue
        n = len(ws)
        share = {w: ws.count(w) / n for w in WORLDS}
        groups = {"everyday": share["everyday"], "fantastical": share["fantastical"],
                  "other worlds": sum(v for w, v in share.items() if w not in ("everyday", "fantastical"))}
        lines.append(f"{folder:7} {n:4}  " + "  ".join(f"{g} {v:4.0%}" for g, v in groups.items()))
        others = sorted(((w, v) for w, v in share.items() if w not in ("everyday", "fantastical")),
                        key=lambda x: -x[1])
        lines.append("         " + " ".join(f"{w} {v:.0%}" for w, v in others))
        aim = RAPID_WORLD_MIX if folder in ("solo", "duo") else WORLD_MIX
        for g, (lo, hi) in aim.items():
            if not lo <= groups[g] <= hi:
                warnings.append(f"{folder}: {g} is {groups[g]:.0%} (aim {lo:.0%}–{hi:.0%})")
        for w, v in others:
            if v > MAX_ONE_WORLD:
                warnings.append(f"{folder}: '{w}' is {v:.0%} (limit {MAX_ONE_WORLD:.0%})")
    return lines, warnings


def shapes(entries):
    lines, problems = [], []
    for folder in ("solo", "duo"):
        live = [p for f, _, p in entries if f == folder and "_error" not in p and p.get("status") != "retired"]
        if not live:
            continue
        n = len(live)
        en = [p.get("text", {}).get("en", "") for p in live]
        found = []
        for name, (rx, cap) in SHAPES["en"].items():
            v = sum(bool(rx.search(t)) for t in en) / n
            found.append(f"{name} {v:.0%}")
            if v > cap:
                problems.append(f"{folder}: {name} is {v:.0%} of prompts (cap {cap:.0%})")
        lines.append(f"{folder:7} " + "  ".join(found))
        openings = {}
        for t in en:
            o = " ".join(t.lower().split()[:2])
            openings[o] = openings.get(o, 0) + 1
        for o, c in sorted(openings.items(), key=lambda x: -x[1]):
            if c / n > MAX_OPENING:
                problems.append(f"{folder}: {c} prompts open with '{o}' (cap {MAX_OPENING:.1%})")
        types = {}
        for p in live:
            types[p.get("type")] = types.get(p.get("type"), 0) + 1
        lines.append("        " + " ".join(f"{t} {c / n:.0%}" for t, c in sorted(types.items(), key=lambda x: -x[1])))
        for t, c in types.items():
            cap = MAX_STATUS_FLIP if t == "status-flip" else MAX_RECIPE
            if folder == "duo" and t == "premise":
                continue
            if c / n > cap:
                problems.append(f"{folder}: recipe {t} is {c / n:.0%} (cap {cap:.0%})")
    return lines, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exclude", type=Path)
    ap.add_argument("--near-dups", action="store_true")
    args = ap.parse_args()
    exclude = []
    if args.exclude:
        exclude = [l for l in args.exclude.read_text().splitlines() if l and not l.startswith("#")]
    entries = load()
    problems = check(entries, exclude, args.near_dups)
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
    lines, warnings = world_mix(entries)
    print("\nWorld mix")
    for line in lines:
        print("  " + line)
    for w in warnings:
        print("  warning: " + w)
    lines, shape_problems = shapes(entries)
    problems += shape_problems
    print("\nRapid fire shapes")
    for line in lines:
        print("  " + line)
    print(f"\n{len(problems)} problem(s)")
    for line in problems:
        print("  " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
