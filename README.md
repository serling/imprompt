# Imprompt

Short improv prompts and scene setups, one at a time, on a phone.

Three modes:

- **Rapid fire:** round-robin prompts for one or two players. Two-player prompts come with a
  gimmick the host can throw in.
- **Scenes:** a setup for two, three or four players, dealt with an emotion and a gimmick the host
  can offer as side-coaching.

A gimmick is drawn from four separate word lists (a physical condition, a way of speaking, a
staging rule, a tempo) and shown simply as "Gimmick".
- **Games:** a short-form game at random, with the suggestions it needs (a location, an
  emotion …) dealt alongside. How to play opens on the card.

Tap a player count to deal. While it plays:

- **Buzzer:** rings to call time.
- **Heighten:** some one-player prompts escalate step by step.
- **Next:** a new prompt for the same number of players.
- **Back** returns to the player count. **Skip** moves on without playing the prompt; it goes
  back in the pile.
- The refresh icon beside a labelled line (an emotion, a gimmick, a game's suggestion) swaps
  just that one. The lines are suggestions: use one, several or none.

Later in a session, characters from earlier prompts come back in new situations. Nothing
repeats on the same device until you tap **Reset**.

## The prompts

One JSON file per prompt, in `prompts/`:

| Folder | What it holds |
|---|---|
| `solo/`, `duo/` | A single prompt, with an optional `callback` phrase for characters that can come back |
| `escalations/` | Four `steps`, each a complete line; the last is a twist. The host decides how far to go. |
| `callbacks/` | A frame with one `{character}` placeholder |
| `scenes/` | A setup for 2, 3 or 4 `players` |

## The words

Shared word lists live in `words/`, one JSON file per word, for every mode to draw on:
`locations/`, `occupations/`, `relationships/`, `objects/` and `styles/`; the character lists
`emotions/` and `physical/`; the gimmicks `speech/`, `staging/` and `tempo/`; and lists games ask
for: `adjectives/` (describing words that aren't feelings, tagged by aspect and tone), `titles/`, `topics/`, `activities/`, `fairytales/`, `problems/`, `animals/` and `letters/`. Scenes are dealt
an emotion, a physical condition and a way of speaking; two-player Rapid fire prompts a way of
speaking, a staging rule and a tempo. A word may recur; it is never used up.

```json
{ "id": "loc01-0004", "status": "draft", "text": { "en": "Hospital corridor" }, "tags": ["health", "everyday", "indoor"] }
```

Tags come from a fixed list in `words/tags.json`: a `domain` shared by every kind (home, work,
travel …), a `feel` (everyday or unusual), and a few per kind, such as `standing` for an
occupation or `bond` for a relationship. The checker rejects any other tag.
Kind, axis and tag names are ids; their labels and descriptions are keyed by language like every
other text, so the tags translate with the words.

## The games

One JSON file per short-form game, in `games/`: a `name`, `aliases`, a one-line `summary`, up to
four `steps`, a `more` note, a `family` (rule, host-calls, elimination, replay, tag-out, guessing,
word-story, physical, other), a `players` range, and `asks`: the word kinds dealt with it, one
line each; an ask can narrow a kind by its tags (`"adjectives:condition+negative"`), and the line
is then labelled by the tag ("Condition"). A kind appears once when its words are used one after another (refresh gives the next),
and several times only when they are in play together. Games are never used up.

Prompts, words and games alike: every text is keyed by language (`"en"` is the source; translations sit alongside it).
`status` is `draft`, `approved` or `retired`. Retired prompts are never played.

## Working on it

```sh
python3 tools/check.py          # check every prompt against the house style
python3 tools/build.py          # build the site into _site/
python3 -m http.server -d _site # play it locally at http://localhost:8000
```

Every push to `main` is checked and published with GitHub Pages.
