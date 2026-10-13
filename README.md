# Imprompt

Short improv prompts for round-robin scenes, one at a time, on a phone.

Tap **Solo** or **Duo** for the next prompt. Nothing repeats on the same device.

- **» (Solo):** some prompts escalate. Tap again for the next, bigger step.
- **↻ (Duo):** rerun the scene with a twist, such as "in reverse" or "entirely in gibberish". Tap again to add a second.
- **Callbacks:** later in a session, characters from earlier scenes come back in new situations.
- **Skip** drops a prompt that doesn't work. Skipped prompts never return.

## The prompts

One JSON file per prompt, in `prompts/`:

| Folder | What it holds |
|---|---|
| `solo/`, `duo/` | A single prompt, with an optional `callback` phrase for characters that can come back |
| `escalations/` | A run of 3–5 `steps`, each a complete line |
| `callbacks/` | A frame with one `{character}` placeholder |
| `modifiers/` | A twist for rerunning a duo scene, with a `kind` (speech, tempo, tone, physical) |

Every text is keyed by language (`"en"` is the source; translations sit alongside it).
`status` is `draft`, `approved` or `retired`. Retired prompts are never played.

## Working on it

```sh
python3 tools/check.py          # check every prompt against the house style
python3 tools/build.py          # build the site into _site/
python3 -m http.server -d _site # play it locally at http://localhost:8000
```

Every push to `main` is checked and published with GitHub Pages.
