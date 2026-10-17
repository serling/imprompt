// Imprompt player. One prompt at a time; prompts and scenes not shown on this device come first.
// Data: deck.json, built from prompts/ and words/ by tools/build.py. Texts are keyed by language.
"use strict";

// English is the source; Norwegian is on its way. A text with no translation shows in English.
const LANGS = ["en", "no"];
// Interface text, by language. {name} marks a value filled in at run time.
const UI = {
  en: {
    langName: { en: "English", no: "Norwegian" },
    mode: "Mode", rapid: "Rapid fire", scenes: "Scenes", games: "Games",
    loadFailMsg: "The prompts couldn't be loaded. Check the connection and reload.",
    noSave: "This browser isn't saving, so prompts may repeat after a reload.",
    reset: "End session", resetArm: "Tap again to end",
    ready: "Ready", done: "Done",
    readyRapid: "Tap New prompt to start.",
    readyScenes: "Tap New scene to start.",
    readyGames: "Tap New game for a short-form game.",
    askPlayers: "How many players?", host: "Host",
    playersAria: "Players", pMore: "{n}+ players",
    noPrompts: "No prompts left.", noScenes: "No scenes left for {n} players.",
    noGames: "No games for {n} players.",
    p1: "1 player", pN: "{n} players",
    buzzer: "Buzzer", newPrompt: "New prompt", newScene: "New scene", newGame: "New game",
    scene: "Scene · {who}", game: "Game · {range} players",
    callback: "Callback",
    howTo: "How to play", aka: "Also called: {list}.", newLine: "New {kind}", gimmick: "Gimmick",
    tapClose: "Tap to close", showLine: "Show {kind} full screen",
    timerAria: "Stopwatch {t}. Tap to start over.",
    soundOn: "Sound on. Tap to mute.", soundOff: "Sound off. Tap to unmute.",
    langAria: "Language: {lang}. Tap for {other}.",
  },
  no: {
    langName: { en: "engelsk", no: "norsk" },
    mode: "Modus", rapid: "Lynrunde", scenes: "Scener", games: "Spill",
    loadFailMsg: "Oppgavene kunne ikke lastes. Sjekk tilkoblingen og last inn på nytt.",
    noSave: "Denne nettleseren lagrer ikke, så oppgaver kan komme igjen etter at siden lastes på nytt.",
    reset: "Avslutt økt", resetArm: "Trykk igjen for å avslutte",
    ready: "Klar", done: "Ferdig",
    readyRapid: "Trykk på Ny oppgave for å starte.",
    readyScenes: "Trykk på Ny scene for å starte.",
    readyGames: "Trykk på Nytt spill for et kortformspill.",
    askPlayers: "Hvor mange spillere?", host: "Leder",
    playersAria: "Spillere", pMore: "{n}+ spillere",
    noPrompts: "Ingen oppgaver igjen.", noScenes: "Ingen scener igjen for {n} spillere.",
    noGames: "Ingen spill for {n} spillere.",
    p1: "1 spiller", pN: "{n} spillere",
    buzzer: "Buzzer", newPrompt: "Ny oppgave", newScene: "Ny scene", newGame: "Nytt spill",
    scene: "Scene · {who}", game: "Spill · {range} spillere",
    callback: "Callback",
    howTo: "Slik spiller dere", aka: "Kalles også: {list}.", newLine: "Ny: {kind}", gimmick: "Gimmick",
    tapClose: "Trykk for å lukke", showLine: "Vis {kind} på hele skjermen",
    timerAria: "Stoppeklokke {t}. Trykk for å starte på nytt.",
    soundOn: "Lyd på. Trykk for å dempe.", soundOff: "Lyd av. Trykk for å slå på.",
    langAria: "Språk: {lang}. Trykk for {other}.",
  },
};
// --- storage (this device only) ---------------------------------------------------------
// One key per tier, so each can be wiped on its own:
//   imprompt-system   {lang, muted}: this device's preferences, kept until changed.
//   imprompt-history  {id: {action, at}}: prompts and scenes shown, kept across sessions.
//   imprompt-session  tonight's workshop: player count, tab, cue, callbacks, and what has been
//                     dealt this session. It ends with End session, or after SESSION_IDLE without
//                     a deal, checked when the page opens and whenever it comes back into view.
const SYSTEM_KEY = "imprompt-system", HISTORY_KEY = "imprompt-history", SESSION_KEY = "imprompt-session";
const SESSION_IDLE = 6 * 3600e3;
const CALLBACK_WINDOW = 30 * 60e3;  // a callback names a character dealt within this time
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};
// Earlier versions kept one key per setting. Shown prompts and preferences move over once; the old
// player count and tab belong to a session long over.
(function migrate() {
  try {
    const old = name => localStorage.getItem("imprompt-" + name);
    if (old("log") !== null && localStorage.getItem(HISTORY_KEY) === null) localStorage.setItem(HISTORY_KEY, old("log"));
    if ((old("lang") !== null || old("muted") !== null) && localStorage.getItem(SYSTEM_KEY) === null)
      store.set(SYSTEM_KEY, { lang: old("lang"), muted: old("muted") === "1" });
    for (const name of ["log", "lang", "muted", "players", "mode", "stopwatch"]) localStorage.removeItem("imprompt-" + name);
  } catch {}
})();
const system = store.get(SYSTEM_KEY) || {};
const saveSystem = () => store.set(SYSTEM_KEY, { lang, muted });
// Never one player. No game needs more than five and no scene more than four, so the last choice
// is "5+ players": a bigger group plays the same scenes and games.
const GROUP_MIN = 2, GROUP_MAX = 5;
const MIN_CALLBACK_GAP = 3;  // a callback names a character played at least this many cues ago

const $ = id => document.getElementById(id);
let lang = "en";
if (LANGS.includes(system.lang)) lang = system.lang;
const say = t => (t && (t[lang] || t.en)) || "";
// Interface text in the current language, with {name} values filled in.
const ui = (key, vals = {}) => String((UI[lang] && UI[lang][key]) ?? UI.en[key])
  .replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");
const players = n => n === 1 ? ui("p1") : ui("pN", { n });

const state = {
  deck: { solo: [], duo: [], callbacks: [], scenes: [], emotions: [], wants: [], styles: [], physical: [], speech: [], staging: [], tempo: [], games: [], kinds: {}, tags: {} },
  mode: "rapid",
  players: 2,         // size of the scene on screen in Scenes mode
  log: {},            // history: id -> { action: "used", at } (older logs may also hold "skipped")
  // The session (saveSession lists what is kept under SESSION_KEY):
  lastActive: null,   // time of the last deal or player count; null: no session yet
  group: null,        // how many players are here: asked at the start of a session
  current: null,      // { entry, kind: "single" | "callback" | "scene" | "game", fill: {en, no} }
  cue: 0,
  shown: new Set(),   // prompts and scenes dealt this session: never twice in one session
  seenCallbacks: new Set(), usedFills: new Set(),
  played: [],         // { entry, cue, at } for characters that can be called back
  coaching: [],       // { slot, kind, entry } lines under the prompt: a refresh replaces its slot's line
  lastCoach: null,    // the slot dealt most recently
  seenCoach: new Set(),
  seenGames: new Set(), // games dealt this session: not dealt again until the list has gone round
  gameWords: [],      // { kind, entry } the suggestions dealt with the game on screen
  howOpen: false,     // How to play stays open or closed from one game to the next
};

// --- history and session ---------------------------------------------------------------
// History is read before every write, so prompts shown in another tab on this phone are kept.
function record(id, action) {
  state.log = { ...(store.get(HISTORY_KEY) || state.log), [id]: { action, at: new Date().toISOString() } };
  if (!store.set(HISTORY_KEY, state.log)) setStatus(ui("noSave"), true);
}
const SESSION_SETS = ["shown", "seenCallbacks", "usedFills", "seenCoach", "seenGames"];
function saveSession() {
  if (!state.lastActive) return;
  const saved = { lastActive: state.lastActive, group: state.group, mode: state.mode, cue: state.cue,
    played: state.played.map(x => ({ id: x.entry.id, cue: x.cue, at: x.at })) };
  for (const k of SESSION_SETS) saved[k] = [...state[k]];
  store.set(SESSION_KEY, saved);
}
// A deal or a new player count keeps the session going.
function touchSession() { state.lastActive = Date.now(); saveSession(); }
// Over after SESSION_IDLE, or if the time is in the future (the phone's clock was set back).
function expired(last) {
  const age = Date.now() - last;
  return !last || age > SESSION_IDLE || age < -60e3;
}
function restoreSession() {
  const s = store.get(SESSION_KEY);
  if (!s || expired(s.lastActive)) { store.remove(SESSION_KEY); return; }
  state.lastActive = s.lastActive;
  if (s.group >= GROUP_MIN) state.group = Math.min(s.group, GROUP_MAX);
  if (READY[s.mode]) state.mode = s.mode;
  state.cue = +s.cue || 0;
  const byId = new Map([...state.deck.solo, ...state.deck.duo].map(e => [e.id, e]));
  state.played = (s.played || []).filter(x => byId.has(x.id)).map(x => ({ entry: byId.get(x.id), cue: x.cue, at: x.at }));
  for (const k of SESSION_SETS) state[k] = new Set(s[k] || []);
}
function clearSession() {
  store.remove(SESSION_KEY);
  Object.assign(state, { lastActive: null, group: null, current: null, cue: 0, played: [],
    coaching: [], lastCoach: null, gameWords: [] });
  for (const k of SESSION_SETS) state[k] = new Set();
}
// A new session: forget tonight (player count, tab, cue, callbacks), keep the history and the
// device's language and sound. Then ask for the player count, as at the start.
function newSession() {
  clearSession();
  renderGroup();
  setMode("rapid", true);
  askGroup();
}
// Checked when the page comes back into view. Another tab on this phone may have kept the session
// going, so the saved time counts too.
function checkSession() {
  if (!state.lastActive) return;
  const last = Math.max(state.lastActive, store.get(SESSION_KEY)?.lastActive || 0);
  if (expired(last)) newSession();
}
// End session: two taps, since the page can't show a confirm dialog: the first arms it for a few seconds.
let resetTimer = null;
function reset() {
  const b = $("reset");
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); renderReset();
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  newSession();
}
function disarmReset() {
  clearTimeout(resetTimer);
  $("reset").classList.remove("armed"); renderReset();
}
// An icon; once armed it also says what the second tap does.
function renderReset() {
  const b = $("reset"), armed = b.classList.contains("armed");
  b.querySelector(".label").textContent = armed ? ui("resetArm") : "";
  b.setAttribute("aria-label", ui(armed ? "resetArm" : "reset"));
  b.title = ui("reset");
}
function setStatus(msg, warn) { $("status").textContent = msg; $("status").className = "status" + (warn ? " warn" : ""); }

// --- pools ------------------------------------------------------------------------------
// Prompts and scenes not yet shown on this device come first. Once all of a list has been shown,
// the ones shown longest ago come back, a few at random so they don't return in the same order.
// Nothing comes twice in one session.
function freshFirst(list) {
  const open = list.filter(e => !state.shown.has(e.id) && state.log[e.id]?.action !== "skipped");
  const unseen = open.filter(e => !state.log[e.id]);
  if (unseen.length) return unseen;
  open.sort((a, b) => (state.log[a.id].at || "").localeCompare(state.log[b.id].at || ""));
  return open.slice(0, Math.ceil(open.length / 5));
}
const promptList = players => (players === 1 ? state.deck.solo : state.deck.duo).filter(e => e.players === players);
const regular = players => freshFirst(promptList(players));
const callbackCandidates = () => state.played.filter(x => state.cue + 1 - x.cue >= MIN_CALLBACK_GAP
  && Date.now() - x.at <= CALLBACK_WINDOW && !state.usedFills.has(x.entry.id));
function callbackPool(players) {
  if (!callbackCandidates().length) return [];
  return state.deck.callbacks.filter(c => c.players === players && !state.seenCallbacks.has(c.id)
    && state.log[c.id]?.action !== "skipped");
}
const pick = list => list[Math.floor(Math.random() * list.length)];

// --- rendering --------------------------------------------------------------------------
function renderCounts() {
  if (state.mode === "scenes") return renderSceneCounts();
  if (state.mode === "games") return renderGameCounts();
  // The buzzer, then New prompt, which deals straight away. Tapping again is the skip, and the
  // prompt is used.
  $("dealRapid").disabled = !state.group || ![1, 2].some(n => regular(n).length + callbackPool(n).length);
}

// A new prompt, scene or game: the card's content slides in a little from the right, like a new
// card laid on the pile. Refreshing a line animates only that line.
function swapCard() {
  const card = $("card");
  card.classList.remove("swap", "buzzed");
  void card.offsetWidth;
  card.classList.add("swap");
}
// fresh: a new prompt or step, so the text animates in. A redraw (language switch) does not.
function renderPrompt(fresh) {
  const c = state.current, text = $("text"), who = $("who");
  if (!c) return;
  if (c.kind === "scene") return renderScene(fresh);
  if (c.kind === "game") return renderGame(fresh);
  $("game").hidden = true;
  const duo = c.entry.players === 2;
  who.textContent = players(c.entry.players)
    + (c.fill ? " · " + ui("callback") : "");
  who.className = "who" + (duo ? " duo" : "");
  if (c.kind === "callback") {
    const [before, after] = say(c.entry.text).split("{character}");
    const name = document.createElement("span");
    name.className = "callback";
    name.textContent = say(c.fill);
    text.replaceChildren(before, name, after);
  } else {
    text.textContent = say(c.entry.text);
  }
  text.className = "text" + (duo ? " duo" : "");
  if (fresh) swapCard();
  renderLines();
}

// --- actions ----------------------------------------------------------------------------
// One button: one or two players at random, even odds, among the counts with prompts left. The
// card names the count, so the host knows who steps up.
function drawRapid() {
  const counts = [1, 2].filter(n => regular(n).length + callbackPool(n).length > 0);
  if (!counts.length) { state.current = null; return idle("done", "noPrompts"); }
  draw(pick(counts));
}
function draw(players) {
  const isCallback = new Set(state.deck.callbacks);
  const pool = regular(players).concat(callbackPool(players));
  if (!pool.length) return;
  const entry = pick(pool);
  const current = { entry, kind: isCallback.has(entry) ? "callback" : "single", fill: null };
  if (current.kind === "callback") {
    const c = pick(callbackCandidates());
    current.fill = c.entry.callback;   // kept by language, so a language switch redraws it
    state.usedFills.add(c.entry.id);
    state.seenCallbacks.add(entry.id);   // callback frames are reusable, so they are not logged as used
  } else {
    record(entry.id, "used");
    state.shown.add(entry.id);
  }
  state.current = current; state.cue += 1;
  if (entry.callback) state.played.push({ entry, cue: state.cue, at: Date.now() });
  dealLines();
  touchSession();
  renderPrompt(true); renderCounts();
  ding(); startTimer();
  keepAwake();
}



// --- lines under the prompt -------------------------------------------------------------
// Each prompt is dealt a few labelled lines from the shared words: caveats the host may offer, or
// not. They are inspiration, never rules stacked on the prompt. Words recur (never logged as used).
// Each slot holds one line; its refresh icon swaps it. Labels come from words/tags.json, by language.
// The gimmick slot draws from four separate lists (physical, speech, staging, tempo) and is shown
// simply as "Gimmick"; each word keeps its own kind. Rapid fire deals no lines: its prompt
// already carries its one twist, and a second would stack on it.
// Scenes: a line for the character and a second line. The character line deals an emotion, a
// want or a secret, each kind as likely as the others whatever the size of its list, and shows
// its own kind, since the three are played differently. The second line pools the gimmicks with
// first lines by word; a first line shows as "First line". Style is left out of scenes: setups
// carry their own tone, and a genre tends to clash with it.
// A slot is a list of groups: a group is picked with even odds, then a word from its lists pooled.
const GIMMICK = ["physical", "speech", "staging", "tempo"];
const SLOTS = {
  character: [["emotions"], ["wants"], ["secrets"]],
  opener: [[...GIMMICK, "firstlines"]],
};
const LINES = { scene: ["character", "opener"] };
const lineKinds = c => c?.kind === "scene" ? LINES.scene : [];
// A kind, or a kind narrowed by tags ("adjectives:condition"): narrowed asks show the first tag's label.
const askParts = spec => { const [kind, narrow = ""] = spec.split(":"); return { kind, tags: narrow.split("+").filter(Boolean) }; };
const kindLabel = spec => {
  if (spec === "gimmick") return ui("gimmick");
  const { kind, tags } = askParts(spec);
  return say((tags.length && state.deck.tags?.[tags[0]]?.label) || state.deck.kinds[kind]?.label) || kind;
};
function dealLines() {
  state.coaching = []; state.lastCoach = null;
  for (const slot of lineKinds(state.current)) dealCoach(slot);
  state.lastCoach = null;
}
// Wants and secrets are often shown to one performer alone: tapping one fills the screen with it.
const SHOWN = ["wants", "secrets"];
function showLine(slot) {
  const x = state.coaching.find(c => c.slot === slot);
  if (!x) return;
  $("revealKind").textContent = kindLabel(x.kind);
  $("revealText").textContent = say(x.entry.text);
  $("reveal").hidden = false;
}
function hideLine() { $("reveal").hidden = true; }
function renderLines() {
  $("mods").hidden = !state.coaching.length;
  $("modList").replaceChildren(...state.coaching.map(x => {
    const li = kindLine(GIMMICK.includes(x.kind) ? "gimmick" : x.kind, x.entry.text, { coach: x.slot });
    li.className = "coach-line" + (x.slot === state.lastCoach ? " fresh" : "");
    if (SHOWN.includes(x.kind)) {
      const s = li.querySelector(".say");
      s.classList.add("show");
      s.dataset.show = x.slot;
      s.setAttribute("role", "button");
      s.tabIndex = 0;
      s.setAttribute("aria-label", ui("showLine", { kind: kindLabel(x.kind).toLowerCase() }));
    }
    return li;
  }));
}

// --- Scenes mode ------------------------------------------------------------------------
// A deliberate scene for 2-4 players: one setup, with lines the host can side-coach with. Any
// scene the group can fill comes up: with three players, two- and three-player scenes.
const sceneList = () => state.deck.scenes.filter(e => e.players <= (state.group || 0));
const scenePool = () => freshFirst(sceneList());
function coachPool(kind) {
  const open = state.deck[kind].filter(e => state.log[e.id]?.action !== "skipped");
  const fresh = open.filter(e => !state.seenCoach.has(e.id));
  if (fresh.length) return fresh;
  open.forEach(e => state.seenCoach.delete(e.id));  // the whole list has been dealt: start it over
  return open;
}

function renderSceneCounts() {
  $("dealScene").disabled = !scenePool().length;
}

const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A labelled line: the kind ("Speech", "Emotion" …) in small capitals, then the text, then
// optionally a refresh icon whose data attributes say what it swaps.
function kindLine(kind, text, refresh) {
  const li = document.createElement("li"), label = document.createElement("span");
  label.className = "kind";
  label.textContent = kindLabel(kind);
  const words = say(text), body = document.createElement("span");
  body.className = "say";
  li.append(label, body);
  if (!refresh) { body.append(words); return li; }
  // The last word and the refresh icon never part, so the icon never wraps onto a line alone.
  const cut = words.lastIndexOf(" ") + 1, tail = document.createElement("span");
  tail.className = "tail";
  tail.textContent = words.slice(cut);
  const b = document.createElement("button");
  b.className = "refresh";
  Object.assign(b.dataset, refresh);
  b.setAttribute("aria-label", ui("newLine", { kind: kindLabel(kind).toLowerCase() }));
  b.innerHTML = REFRESH_ICON;
  tail.append(b);
  body.append(words.slice(0, cut), tail);
  return li;
}
function renderScene(fresh) {
  const c = state.current, text = $("text"), who = $("who");
  $("game").hidden = true;
  who.textContent = ui("scene", { who: players(c.entry.players) });
  who.className = "who scene";
  text.textContent = say(c.entry.text);
  text.className = "text scene";
  if (fresh) swapCard();
  renderLines();
}

function drawScene() {
  const pool = scenePool();
  if (!pool.length) { state.current = null; return idle("done", "noScenes", { n: groupText() }); }
  const entry = pick(pool);
  record(entry.id, "used");
  state.shown.add(entry.id);
  state.current = { entry, kind: "scene" }; state.cue += 1;
  dealLines();
  touchSession();
  renderScene(true); renderSceneCounts();
  ding(); startTimer();
  keepAwake();
}

// Within a group the lists are pooled, so a bigger list comes up more often.
function dealCoach(slot) {
  const groups = SLOTS[slot].map(g => g.flatMap(kind => coachPool(kind).map(entry => ({ kind, entry }))))
    .filter(g => g.length);
  const pool = groups.length ? pick(groups) : [];
  if (!pool.length) return null;
  const { kind, entry } = pick(pool);
  state.seenCoach.add(entry.id);
  state.coaching = state.coaching.filter(x => x.slot !== slot).concat({ slot, kind, entry })
    .sort((a, b) => lineKinds(state.current).indexOf(a.slot) - lineKinds(state.current).indexOf(b.slot));
  state.lastCoach = slot;
  return entry;
}

// The refresh icon beside a line swaps only that line, quietly: only that line animates.
function coach(slot) {
  if (!dealCoach(slot)) return;
  renderLines();
  saveSession();
}


// --- group size ---------------------------------------------------------------------------
// How many players, not counting the host (the one holding the phone). Asked in the card at the
// start of each session; after that a small select in the settings bar. It caps the scenes and
// games that come up.
const PERSON_ICON = '<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><circle cx="12" cy="7" r="4.2" fill="currentColor"/><path d="M3.5 22c0-4.9 3.8-8.6 8.5-8.6s8.5 3.7 8.5 8.6z" fill="currentColor"/></svg>';
function groupText(n = state.group) { return n >= GROUP_MAX ? ui("pMore", { n: GROUP_MAX }) : players(n); }
function renderGroup() {
  const sel = $("group");
  const counts = Array.from({ length: GROUP_MAX - GROUP_MIN + 1 }, (_, i) => GROUP_MIN + i);
  sel.replaceChildren(...counts.map(n => new Option(groupText(n), n)));
  sel.value = state.group || "";
  sel.setAttribute("aria-label", ui("playersAria"));
  $("groupWrap").hidden = !state.group;
  // The picker shows the sum: the host (you, holding the phone) plus the players on the buttons.
  const host = document.createElement("div"), label = document.createElement("span");
  host.className = "host";
  host.innerHTML = PERSON_ICON;
  label.textContent = ui("host");
  host.append(label);
  const plus = document.createElement("div");
  plus.className = "plus"; plus.textContent = "+"; plus.setAttribute("aria-hidden", "true");
  const grid = document.createElement("div");
  grid.className = "counts";
  grid.append(...counts.map(n => {
    const b = document.createElement("button");
    b.textContent = n >= GROUP_MAX ? GROUP_MAX + "+" : String(n);
    b.setAttribute("aria-label", groupText(n));
    b.addEventListener("click", () => setGroup(n));
    return b;
  }));
  $("picker").replaceChildren(host, plus, grid);
}
function setGroup(n) {
  state.group = n;
  touchSession();
  renderGroup();
  if (idleView?.message === "askPlayers") idle("ready", READY[state.mode]);
  else renderCounts();
}
const askGroup = () => idle("playersAria", "askPlayers");

// The card between prompts. Label and message are UI keys, kept so a language switch can redraw them.
let idleView = null;
function idle(label, message, vals) {
  idleView = { label, message, vals };
  $("picker").hidden = message !== "askPlayers";
  // Until the player count is picked, the picker is all there is: no tabs, tools, buzzer or deal.
  // The settings bar stays.
  document.querySelector(".controls").hidden = message === "askPlayers";
  document.body.classList.toggle("asking", message === "askPlayers");
  $("card").classList.toggle("asking", message === "askPlayers");
  $("who").textContent = ui(label);
  $("who").className = "who";
  $("text").textContent = ui(message, vals);
  $("text").className = "text idle";
  $("mods").hidden = true;
  $("game").hidden = true;
  stopTimer();
  renderCounts();
}

const READY = { rapid: "readyRapid", scenes: "readyScenes", games: "readyGames" };

function setMode(mode, quiet) {
  if (mode !== state.mode && state.current) state.current = null;
  state.mode = mode;
  saveSession();
  const scenes = mode === "scenes", games = mode === "games";
  $("modeRapid").setAttribute("aria-pressed", String(mode === "rapid"));
  $("modeScenes").setAttribute("aria-pressed", String(scenes));
  $("modeGames").setAttribute("aria-pressed", String(games));
  $("rapidWrap").hidden = mode !== "rapid";
  $("scenesWrap").hidden = !scenes;
  $("gamesWrap").hidden = !games;
  document.body.classList.toggle("scenes-on", scenes);
  document.body.classList.toggle("games-on", games);
  state.coaching = []; state.lastCoach = null;
  if (!quiet) state.group ? idle("ready", READY[mode]) : askGroup();
}

// --- games ------------------------------------------------------------------------------
// A short-form game as a suggestion: dealt at random, never used up, not dealt again until the
// list has gone round. The suggestions it asks for come from the shared words.
function pickWord(spec, taken) {
  const { kind, tags } = askParts(spec);
  const pool = (state.deck[kind] || []).filter(e => !taken.has(e.id) && tags.every(t => (e.tags || []).includes(t)));
  return pool.length ? pick(pool) : null;
}
// Any game whose minimum the group meets; bigger groups take turns or watch.
const gamePool = () => state.deck.games.filter(g => g.players.min <= (state.group || 0));
function drawGame() {
  const fits = gamePool();
  let pool = fits.filter(g => !state.seenGames.has(g.id));
  if (!pool.length) { state.seenGames.clear(); pool = fits; }
  if (!pool.length) { state.current = null; return idle("done", "noGames", { n: groupText() }); }
  const entry = pick(pool);
  state.seenGames.add(entry.id);
  const taken = new Set();
  state.gameWords = (entry.asks || []).map(kind => {
    const w = pickWord(kind, taken);
    if (w) taken.add(w.id);
    return { kind, entry: w };
  }).filter(x => x.entry);
  state.current = { entry, kind: "game" }; state.cue += 1;
  touchSession();
  renderGame(true); renderGameCounts();
  ding(); startTimer();
  keepAwake();
}
// The refresh icon beside a suggestion swaps only that one.
function refreshGameWord(slot) {
  const x = state.gameWords[slot];
  if (!x) return;
  const w = pickWord(x.kind, new Set(state.gameWords.map(y => y.entry.id)));
  if (!w) return;
  x.entry = w; x.fresh = true;
  renderGame();
  x.fresh = false;
}
function renderGame(fresh) {
  const g = state.current.entry, text = $("text"), who = $("who"), box = $("game");
  const { min, max } = g.players;
  who.textContent = ui("game", { range: min === max ? min : `${min}–${max}` });
  who.className = "who game";
  text.textContent = say(g.name);
  text.className = "text game-name";
  if (fresh) swapCard();
  $("mods").hidden = true;
  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = say(g.summary);
  const parts = [summary];
  if (state.gameWords.length) {
    const words = document.createElement("ul");
    words.className = "words";
    words.append(...state.gameWords.map((x, i) => {
      const li = kindLine(x.kind, x.entry.text, { slot: i });
      if (x.fresh) li.className = "fresh";
      return li;
    }));
    parts.push(words);
  }
  // How to play opens in place: the steps, then notes and other names. Closed, the card always fits.
  const how = document.createElement("details"), label = document.createElement("summary");
  label.textContent = ui("howTo");
  const steps = document.createElement("ol");
  steps.append(...say(g.steps).map(t => { const li = document.createElement("li"); li.textContent = t; return li; }));
  const note = document.createElement("p");
  note.textContent = say(g.more);
  how.append(label, steps, note);
  const aliases = say(g.aliases);
  if (aliases.length) {
    const aka = document.createElement("p");
    aka.className = "aka";
    aka.textContent = ui("aka", { list: aliases.join(", ") });
    how.append(aka);
  }
  how.open = state.howOpen;
  how.addEventListener("toggle", () => { state.howOpen = how.open; });
  parts.push(how);
  box.replaceChildren(...parts);
  box.hidden = false;
}
function renderGameCounts() {
  $("dealGame").disabled = !gamePool().length;
}

// --- timer ------------------------------------------------------------------------------
// A stopwatch, never a countdown: no pre-defined times, so no expectations. It
// starts at 0:00 with every new prompt, scene or game and counts up on its button; tapping it
// starts it over at 0:00. It never rings or stops a scene.
const timer = { start: 0, tick: null };
const clock = secs => Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
function renderTimer() {
  const b = $("timer"), secs = timer.tick ? Math.floor((Date.now() - timer.start) / 1000) : 0;
  b.querySelector(".label").textContent = clock(secs);
  b.classList.toggle("on", !!timer.tick);
  b.setAttribute("aria-label", ui("timerAria", { t: clock(secs) }));
}
function startTimer() {
  stopTimer();
  if (!state.current) return;
  timer.start = Date.now();
  timer.tick = setInterval(renderTimer, 250);
  renderTimer();
}
function stopTimer() { clearInterval(timer.tick); timer.tick = null; renderTimer(); }

// --- sound ------------------------------------------------------------------------------
// Two recorded sounds (CC0, see CREDITS.md): one blop for every new prompt, whatever it is, and
// the buzzer that ends a scene. Each has a synthesised stand-in if its file can't be loaded.
let audio = null;
try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
let muted = !!system.muted;
function renderMute() {
  $("mute").setAttribute("aria-pressed", String(muted));
  $("mute").setAttribute("aria-label", ui(muted ? "soundOff" : "soundOn"));
}

const recordings = {};   // name -> { file: ArrayBuffer, buffer: AudioBuffer }
for (const name of ["blop", "buzzer"]) {
  recordings[name] = {};
  fetch(`sounds/${name}.mp3`).then(r => r.ok ? r.arrayBuffer() : null).then(b => { recordings[name].file = b; }).catch(() => {});
}
// Plays a recording; returns false if it isn't available, so the caller can synthesise instead.
async function play(name) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const r = recordings[name];
    if (!r.buffer && r.file) r.buffer = await audio.decodeAudioData(r.file.slice(0));
    if (!r.buffer) return false;
    const src = audio.createBufferSource();
    src.buffer = r.buffer;
    src.connect(audio.destination);
    src.start();
    return true;
  } catch { return false; }
}

// The same blop for every new prompt, scene or game. Refreshing a line is silent.
async function ding() {
  if (muted) return;
  if (!(await play("blop"))) synthDing();
}

// Fallback: a soft two-note "bl-ing".
function synthDing() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const out = audio.createGain();
    out.gain.value = 0.45;
    out.connect(audio.destination);
    const note = (t, freq) => {
      const osc = audio.createOscillator(), env = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 0.9, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + 0.5);
    };
    note(audio.currentTime, 784);
    note(audio.currentTime + 0.07, 988);
  } catch {}
}

// The buzzer: it only rings, ending nothing on screen. Respects mute; the card flashes either way so the room sees the
// scene end.
async function buzzer() {
  const card = $("card");
  card.classList.remove("buzzed");
  void card.offsetWidth;
  card.classList.add("buzzed");
  if (muted) return;
  if (!(await play("buzzer"))) synthBuzzer();
}

// Fallback: one coarse sawtooth tone, rattled by a fast on-off modulation, stopping dead.
function synthBuzzer() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime, end = t + 0.75;
    const out = audio.createGain(), rattle = audio.createGain(), tone = audio.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    out.gain.setValueAtTime(0.35, end - 0.015);
    out.gain.linearRampToValueAtTime(0, end);
    // Rattle: a 45 Hz square wave swings the level between full and about a fifth.
    rattle.gain.value = 0.6;
    const lfo = audio.createOscillator(), depth = audio.createGain();
    lfo.type = "square";
    lfo.frequency.value = 45;
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(rattle.gain);
    const osc = audio.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 120;
    osc.connect(rattle).connect(tone).connect(out).connect(audio.destination);
    for (const node of [osc, lfo]) { node.start(t); node.stop(end + 0.02); }
  } catch {}
}

// --- screen stays on while a prompt is showing --------------------------------------------
let lock = null;
async function keepAwake() {
  if (lock || !("wakeLock" in navigator)) return;
  try { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkSession();
  if (state.current) keepAwake();
});
// A page restored from the browser's back/forward cache runs no load code: check it the same way.
window.addEventListener("pageshow", e => { if (e.persisted) checkSession(); });

// --- start ------------------------------------------------------------------------------
for (const b of document.querySelectorAll(".buzz")) b.addEventListener("click", buzzer);
$("reset").addEventListener("click", reset);
$("timer").addEventListener("click", startTimer);
$("mute").addEventListener("click", () => {
  muted = !muted;
  saveSystem();
  renderMute();
});
renderMute();
function renderLang() {
  const other = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
  $("lang").textContent = lang.toUpperCase();
  const names = UI[lang].langName;
  $("lang").setAttribute("aria-label", ui("langAria", { lang: names[lang], other: names[other] }));
  // Static labels in the page carry data-ui (text) or data-ui-aria (aria-label) keys.
  for (const el of document.querySelectorAll("[data-ui]")) el.textContent = ui(el.dataset.ui);
  for (const el of document.querySelectorAll("[data-ui-aria]")) el.setAttribute("aria-label", ui(el.dataset.uiAria));
  renderGroup();
  for (const el of document.querySelectorAll("[data-count]")) el.textContent = players(+el.dataset.count);
  document.documentElement.lang = lang;
}
$("lang").addEventListener("click", () => {
  lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
  saveSystem();
  renderLang();
  if (state.current) { renderPrompt(); renderCounts(); }
  else if (idleView) idle(idleView.label, idleView.message, idleView.vals);
  else renderCounts();
  renderTimer(); renderMute();
  renderReset();
});
renderLang();
$("dealScene").addEventListener("click", drawScene);
$("dealRapid").addEventListener("click", drawRapid);
$("group").addEventListener("change", e => setGroup(+e.target.value));
$("modList").addEventListener("click", e => {
  const b = e.target.closest(".refresh");
  if (b) return coach(b.dataset.coach);
  const s = e.target.closest(".say.show");
  if (s) showLine(s.dataset.show);
});
$("modList").addEventListener("keydown", e => {
  const s = e.target.closest(".say.show");
  if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showLine(s.dataset.show); }
});
$("reveal").addEventListener("click", hideLine);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("reveal").hidden) hideLine(); });
$("modeRapid").addEventListener("click", () => setMode("rapid"));
$("modeScenes").addEventListener("click", () => setMode("scenes"));
$("modeGames").addEventListener("click", () => setMode("games"));
$("dealGame").addEventListener("click", drawGame);
$("game").addEventListener("click", e => { const b = e.target.closest(".refresh"); if (b) refreshGameWord(+b.dataset.slot); });

(async function start() {
  state.log = store.get(HISTORY_KEY) || {};
  renderReset();
  try {
    state.deck = { ...state.deck, ...await (await fetch("deck.json", { cache: "no-cache" })).json() };
  } catch {
    setStatus(ui("loadFailMsg"), true);
    return;
  }
  $("reset").disabled = false;
  restoreSession();
  setMode(state.mode, true);
  renderGroup();
  state.group ? idle("ready", READY[state.mode]) : askGroup();
  renderCounts();
  renderTimer();
})();
