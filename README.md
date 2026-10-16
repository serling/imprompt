# Imprompt

Short improv prompts and scene setups, one at a time, on a phone.

At the start of a session, the app asks how many players there are (not counting the host).
That number sits in a small menu at the top and can be changed any time; it decides which scenes
and games can come up.

Three modes, each one row of buttons for the whole session, with the buzzer on the left:

- **Rapid fire:** round-robin prompts. **New prompt** deals the next one straight away, for one
  or two players at random; the card says which. The prompt stands alone, with nothing under it.
- **Scenes:** **New scene** deals a setup for as many players as you have or fewer, with a
  line for the character (an emotion; a want, what the character is after; or a secret, for the
  host to read out or show one player) and a second line the host can offer: a gimmick, or a
  first line to open the scene with.
- **Games:** **New game** deals a short-form game your group is big enough for, with the
  suggestions it needs (a location, an emotion …). How to play opens on the card.

A gimmick is drawn from four separate word lists (a physical condition, a way of speaking, a
staging rule, a tempo) and shown simply as "Gimmick". The refresh icon beside a labelled line (an
emotion, a gimmick, a game's suggestion) swaps just that one. The lines are suggestions: use one,
several or none. The **Buzzer** only rings to call time.

Later in a session, characters from the last half hour come back in new situations.

Everything is kept on the phone only, in three parts:

- **Language and sound** stay until changed.
- **Prompts and scenes already shown** are remembered across sessions. Ones not shown on this
  phone come first; once a list has been shown in full, the ones shown longest ago come back.
- **The session** (player count, tab, callbacks, what has been dealt tonight) ends when you tap
  **End session**, or by itself after six hours without a new prompt. Nothing comes twice in one
  session.

## The prompts

One JSON file per prompt, in `prompts/`:

| Folder | What it holds |
|---|---|
| `solo/`, `duo/` | A single prompt, with an optional `callback` phrase for characters that can come back |
| `escalations/` | Four `steps`, each a complete line; the last is a twist. Kept, but not dealt by the app at the moment. |
| `callbacks/` | A frame with one `{character}` placeholder |
| `scenes/` | A setup for 2, 3 or 4 `players` |

## The words

Shared word lists live in `words/`, one JSON file per word, for every mode to draw on:
`locations/`, `occupations/`, `relationships/`, `objects/` and `styles/`; the character lists
`emotions/`, `wants/`, `secrets/` and `physical/`; the gimmicks `speech/`, `staging/` and `tempo/`;
`firstlines/`, lines of dialogue to open a scene; and lists games ask
for: `adjectives/` (describing words that aren't feelings, tagged by aspect and tone), `titles/`, `topics/`, `activities/`, `fairytales/`, `problems/`, `animals/` and `letters/`. Scenes are dealt
an emotion, a want or a secret (each kind equally likely), and a gimmick or a first line. A gimmick is drawn
from `physical/`, `speech/`, `staging/` and `tempo/`. A word may recur; it is never used up.

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
