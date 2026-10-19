# Imprompt

Short improv prompts and scene setups, one at a time, on a phone.

At the start of a session, the app asks how many players there are (not counting the host).
That number sits in a small menu at the top and can be changed any time; it decides which scenes
and games can come up.

Three modes, each one row of buttons for the whole session, with the buzzer and the bell on the left:

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
several or none. Every line has a faint dashed underline: tap it to show just that line full
screen to one performer, and tap again to close. The **Buzzer** only rings to call time; the
**Bell** is a lighter ding, for a "new choice".

Everything is kept on the phone only, in three parts:

- **Language and sound** stay until changed.
- **Prompts and scenes already shown** are remembered across sessions. Ones not shown on this
  phone come first; once a list has been shown in full, the ones shown longest ago come back.
- **The session** (player count, tab, what has been dealt tonight) ends when you tap
  **End session**, or by itself after six hours without a new prompt. Nothing comes twice in one
  session.

## The content

Every file's fields are defined in `schema/content.schema.json` (JSON Schema), and the checker
validates each file against it. Every text is keyed by language (`"en"` is the source;
translations sit alongside it). Retired files are never played and never deleted, so ids stay
stable.

| Folder | What it holds |
|---|---|
| `prompts/solo/`, `prompts/duo/` | Rapid-fire prompts for one or two players |
| `prompts/scenes/` | Scene setups for 2, 3 or 4 players |
| `prompts/escalations/`, `prompts/callbacks/` | Kept, but not dealt by the app |
| `words/<kind>/` | One word per file, for every mode to draw on; the kinds and their tags are in `words/tags.json` |
| `games/` | One short-form game per file |

Scenes are dealt an emotion, a want or a secret, and a gimmick (`physical`, `speech`, `staging`,
`tempo`) or a first line. A word may recur; it is never used up. A game's `asks` names the word
kinds dealt with it, one line each; an ask can narrow a kind by its tags
(`"adjectives:condition+negative"`). The app gets its content through `app/content.js` and picks
what to deal in `app/deal.js`.

## Working on it

```sh
python3 tools/check.py          # check every file against the schema and the house style
python3 tools/check.py --near-dups  # also search for near-duplicate prompts (slow)
python3 tools/build.py          # build the site into _site/
python3 -m http.server -d _site # play it locally at http://localhost:8000
```

Every push to `main` is checked and published with GitHub Pages.
