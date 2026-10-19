#!/usr/bin/env python3
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAYABLE = {"approved", "draft"}


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "app", out)
    deck = {}
    kinds = json.loads((ROOT / "words" / "tags.json").read_text())["kinds"]
    sources = [("prompts", f) for f in ("solo", "duo", "scenes")]
    sources += [("words", k) for k in kinds]
    for top, folder in sources:
        items = []
        for f in sorted((ROOT / top / folder).glob("*.json")):
            p = json.loads(f.read_text())
            if p.get("status") in PLAYABLE:
                p.pop("status", None)
                items.append(p)
        deck[folder] = items
    deck["games"] = [g for g in (json.loads(f.read_text()) for f in sorted((ROOT / "games").glob("*.json")))
                     if g.get("status") in PLAYABLE]
    for g in deck["games"]:
        g.pop("status", None)
    deck["kinds"] = {k: {"label": v["label"]} for k, v in kinds.items()}
    axes = json.loads((ROOT / "words" / "tags.json").read_text())["axes"]
    deck["tags"] = {t: {"label": v["label"]} for ax in axes.values() for t, v in ax["values"].items()}
    (out / "deck.json").write_text(json.dumps(deck, ensure_ascii=False, separators=(",", ":")))
    print({k: len(v) for k, v in deck.items()}, "->", out)


if __name__ == "__main__":
    main()
