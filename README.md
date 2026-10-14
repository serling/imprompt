# Imprompt

Short improv prompts and scene setups, one at a time, on a phone.

Two modes:

- **Rapid fire:** round-robin prompts for one or two players.
- **Scenes:** a setup for two, three or four players, dealt with an emotion and a style the
  host can side-coach with.

Tap a player count to deal. While it plays:

- **Buzzer:** rings to call time.
- **Heighten:** some one-player prompts escalate step by step; two-player scenes can be rerun
  with a twist, such as "in reverse" or "entirely in gibberish".
- **Next:** a new prompt for the same number of players.
- **Back** returns to the player count. **Skip** moves on without playing the prompt; it goes
  back in the pile.
- In Scenes, the refresh icon beside the emotion or the style swaps just that one.

Later in a session, characters from earlier prompts come back in new situations. Nothing
repeats on the same device until you tap **Reset**.

## The prompts

One JSON file per prompt, in `prompts/`:

| Folder | What it holds |
|---|---|
| `solo/`, `duo/` | A single prompt, with an optional `callback` phrase for characters that can come back |
| `escalations/` | Four `steps`, each a complete line; the last is a twist. The host decides how far to go. |
| `callbacks/` | A frame with one `{character}` placeholder |
| `modifiers/` | A twist for rerunning a two-player scene, with a `kind` (speech, tempo, tone, physical) |
| `scenes/` | A setup for 2, 3 or 4 `players` |
| `emotions/`, `styles/` | Side-coaching words for scenes |

Every text is keyed by language (`"en"` is the source; translations sit alongside it).
`status` is `draft`, `approved` or `retired`. Retired prompts are never played.

## Working on it

```sh
python3 tools/check.py          # check every prompt against the house style
python3 tools/build.py          # build the site into _site/
python3 -m http.server -d _site # play it locally at http://localhost:8000
```

Every push to `main` is checked and published with GitHub Pages.
