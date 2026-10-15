#!/usr/bin/env python3
"""Bundle the playable prompts into one file for the player.

Usage: python3 tools/build.py [OUTPUT_DIR]   (default: _site)
Copies app/ into OUTPUT_DIR and writes OUTPUT_DIR/deck.json.
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# While the deck is being reviewed, drafts are played too. Narrow to {"approved"} when it settles.
PLAYABLE = {"approved", "draft"}


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "app", out)
    deck = {}
    kinds = json.loads((ROOT / "words" / "tags.json").read_text())["kinds"]
    sources = [("prompts", f) for f in ("solo", "duo", "escalations", "callbacks", "scenes")]
    sources += [("words", k) for k in kinds]
    for top, folder in sources:
        items = []
        for f in sorted((ROOT / top / folder).glob("*.json")):
            p = json.loads(f.read_text())
            if p.get("status") in PLAYABLE:
                p.pop("status", None)
                items.append(p)
        deck[folder] = items
    # Short-form games: reusable frames, never used up.
    deck["games"] = [g for g in (json.loads(f.read_text()) for f in sorted((ROOT / "games").glob("*.json")))
                     if g.get("status") in PLAYABLE]
    for g in deck["games"]:
        g.pop("status", None)
    # Word kind labels, by language, for the player to show ("Emotion", "Speech" …).
    deck["kinds"] = {k: {"label": v["label"]} for k, v in kinds.items()}
    # Tag labels too: a game asking for "adjectives:condition" labels its line "Condition".
    axes = json.loads((ROOT / "words" / "tags.json").read_text())["axes"]
    deck["tags"] = {t: {"label": v["label"]} for ax in axes.values() for t, v in ax["values"].items()}
    (out / "deck.json").write_text(json.dumps(deck, ensure_ascii=False, separators=(",", ":")))
    print({k: len(v) for k, v in deck.items()}, "->", out)


if __name__ == "__main__":
    main()
