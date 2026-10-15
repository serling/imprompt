// Imprompt player. One prompt at a time; nothing repeats on this device.
// Data: deck.json, built from prompts/ and words/ by tools/build.py. Texts are keyed by language.
"use strict";

// English is the source; Norwegian is on its way. A text with no translation shows in English.
const LANGS = ["en", "no"];
// Interface text, by language. {name} marks a value filled in at run time.
const UI = {
  en: {
    langName: { en: "English", no: "Norwegian" },
    mode: "Mode", rapid: "Rapid fire", scenes: "Scenes", games: "Games",
    loading: "Loading deck…", loadFail: "Deck failed to load",
    loadFailMsg: "The prompts couldn't be loaded. Check the connection and reload.",
    noSave: "This browser isn't saving, so prompts may repeat after a reload.",
    cue: "Cue {n}", reset: "Reset", resetArm: "Tap again to reset",
    ready: "Ready", done: "Done", resetDone: "Reset",
    readyRapid: "Tap a player count for the next prompt.",
    readyScenes: "Tap a player count to start a scene.",
    readyGames: "Tap for a short-form game.",
    noPrompts: "No {n}-player prompts left.", noScenes: "No {n}-player scenes left.",
    p1: "1 player", pN: "{n} players",
    buzzer: "Buzzer", heighten: "Heighten", next: "Next", back: "Back", skip: "Skip", newGame: "New game",
    nextAria: "Next: a new prompt for the same number of players", nextGameAria: "Next: another game",
    heightenAria: "Heighten: next step",
    dealRapidAria: "New prompt, {who}", dealSceneAria: "New scene, {who}",
    leftRapid: "Left · 1p {s} · 2p {d} · {u} used",
    leftScenes: "Scenes left · 2p {a} · 3p {b} · 4p {c}", gamesCount: "Games · {n}",
    scene: "Scene · {who}", game: "Game · {range} players",
    heightenTimes: "Heighten ×{n}", callback: "Callback",
    howTo: "How to play", aka: "Also called: {list}.", newLine: "New {kind}",
    off: "Off", timerOff: "Timer off. Tap to set.", timerOn: "Timer {t}. Tap to change.",
    soundOn: "Sound on. Tap to mute.", soundOff: "Sound off. Tap to unmute.",
    langAria: "Language: {lang}. Tap for {other}.",
  },
  no: {
    langName: { en: "engelsk", no: "norsk" },
    mode: "Modus", rapid: "Lynrunde", scenes: "Scener", games: "Spill",
    loading: "Laster kortstokken …", loadFail: "Kunne ikke laste kortstokken",
    loadFailMsg: "Oppgavene kunne ikke lastes. Sjekk tilkoblingen og last inn på nytt.",
    noSave: "Denne nettleseren lagrer ikke, så oppgaver kan komme igjen etter at siden lastes på nytt.",
    cue: "Nr. {n}", reset: "Nullstill", resetArm: "Trykk igjen for å nullstille",
    ready: "Klar", done: "Ferdig", resetDone: "Nullstilt",
    readyRapid: "Trykk på antall spillere for neste oppgave.",
    readyScenes: "Trykk på antall spillere for å starte en scene.",
    readyGames: "Trykk for et kortformspill.",
    noPrompts: "Ingen oppgaver for {n} spillere igjen.", noScenes: "Ingen scener for {n} spillere igjen.",
    p1: "1 spiller", pN: "{n} spillere",
    buzzer: "Buzzer", heighten: "Skru opp", next: "Neste", back: "Tilbake", skip: "Hopp over", newGame: "Nytt spill",
    nextAria: "Neste: en ny oppgave for like mange spillere", nextGameAria: "Neste: et annet spill",
    heightenAria: "Skru opp: neste trinn",
    dealRapidAria: "Ny oppgave, {who}", dealSceneAria: "Ny scene, {who}",
    leftRapid: "Igjen · 1s {s} · 2s {d} · {u} brukt",
    leftScenes: "Scener igjen · 2s {a} · 3s {b} · 4s {c}", gamesCount: "Spill · {n}",
    scene: "Scene · {who}", game: "Spill · {range} spillere",
    heightenTimes: "Skru opp ×{n}", callback: "Callback",
    howTo: "Slik spiller dere", aka: "Kalles også: {list}.", newLine: "Ny: {kind}",
    off: "Av", timerOff: "Tidtaker av. Trykk for å stille inn.", timerOn: "Tidtaker {t}. Trykk for å endre.",
    soundOn: "Lyd på. Trykk for å dempe.", soundOff: "Lyd av. Trykk for å slå på.",
    langAria: "Språk: {lang}. Trykk for {other}.",
  },
};
const LANG_KEY = "imprompt-lang";
const LOG_KEY = "imprompt-log";
const MUTE_KEY = "imprompt-muted";
const MODE_KEY = "imprompt-mode";       // "rapid" | "scenes" | "games"
const MIN_CALLBACK_GAP = 3;  // a callback names a character played at least this many cues ago

const $ = id => document.getElementById(id);
let lang = "en";
try { if (LANGS.includes(localStorage.getItem(LANG_KEY))) lang = localStorage.getItem(LANG_KEY); } catch {}
const say = t => (t && (t[lang] || t.en)) || "";
// Interface text in the current language, with {name} values filled in.
const ui = (key, vals = {}) => String((UI[lang] && UI[lang][key]) ?? UI.en[key])
  .replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");
const players = n => n === 1 ? ui("p1") : ui("pN", { n });
const cueText = () => ui("cue", { n: String(state.cue).padStart(3, "0") });

const state = {
  deck: { solo: [], duo: [], escalations: [], callbacks: [], scenes: [], emotions: [], styles: [], physical: [], speech: [], staging: [], tempo: [], games: [], kinds: {} },
  mode: "rapid",
  players: 2,         // size of the scene on screen in Scenes mode
  log: {},            // id -> { action: "used", at } (older logs may also hold "skipped")
  passed: new Set(),  // prompts skipped this session: back in the pile, but not dealt again until a reload
  current: null,      // { entry, kind: "single" | "sequence" | "callback", step, fill }
  cue: 0,
  seenCallbacks: new Set(), usedFills: new Set(),
  played: [],         // { entry, cue } for characters that can be called back (this session only)
  coaching: [],       // { kind, entry } lines under the prompt: one slot per kind, a refresh replaces it
  lastCoach: null,    // the kind dealt most recently (Skip replaces it)
  seenCoach: new Set(),
  seenGames: new Set(), // games dealt this session: not dealt again until the list has gone round
  gameWords: [],      // { kind, entry } the suggestions dealt with the game on screen
  howOpen: false,     // How to play stays open or closed from one game to the next
};

// --- storage (this device only) ---------------------------------------------------------
function loadLog() {
  try { state.log = JSON.parse(localStorage.getItem(LOG_KEY) || "{}"); } catch { state.log = {}; }
}
function record(id, action) {
  state.log[id] = { action, at: new Date().toISOString() };
  try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log)); }
  catch { setStatus(ui("noSave"), true); }
}
// Reset: forget every used prompt on this device, so the whole deck comes back.
// Two taps, since the page can't show a confirm dialog: the first arms it for a few seconds.
let resetTimer = null;
function reset() {
  const b = $("reset");
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = ui("resetArm");
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  state.log = {};
  try { localStorage.removeItem(LOG_KEY); } catch {}
  state.current = null; state.cue = 0; state.played = []; state.passed.clear();
  state.coaching = []; state.lastCoach = null;
  for (const seen of [state.seenCallbacks, state.usedFills, state.seenCoach]) seen.clear();
  $("cueNo").textContent = ui("cue", { n: "—" });
  idle("resetDone", READY[state.mode]);
}
function disarmReset() {
  clearTimeout(resetTimer);
  $("reset").classList.remove("armed"); $("reset").textContent = ui("reset");
}
function unrecord(id) {
  delete state.log[id];
  try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log)); } catch {}
}
function setStatus(msg, warn) { $("status").textContent = msg; $("status").className = "status" + (warn ? " warn" : ""); }

// --- pools ------------------------------------------------------------------------------
const regular = players => [...(players === 1 ? state.deck.solo : state.deck.duo), ...state.deck.escalations]
  .filter(e => e.players === players && !state.log[e.id] && !state.passed.has(e.id));
const callbackCandidates = () =>
  state.played.filter(x => state.cue + 1 - x.cue >= MIN_CALLBACK_GAP && !state.usedFills.has(x.entry.id));
function callbackPool(players) {
  if (!callbackCandidates().length) return [];
  return state.deck.callbacks.filter(c => c.players === players && !state.seenCallbacks.has(c.id)
    && state.log[c.id]?.action !== "skipped");
}
const hasNextStep = c => !!c && c.kind === "sequence" && c.step < c.entry.steps.length - 1;
const pick = list => list[Math.floor(Math.random() * list.length)];

// --- rendering --------------------------------------------------------------------------
function renderCounts() {
  if (state.mode === "scenes") return renderSceneCounts();
  if (state.mode === "games") return renderGameCounts();
  const s = regular(1).length, d = regular(2).length;
  for (const b of document.querySelectorAll("[data-rapid]")) b.disabled = regular(+b.dataset.rapid).length === 0;
  $("skip").hidden = !state.current;
  $("back").hidden = !state.current;
  // Choosing: a button per player count. Playing: the buzzer (left), Heighten while an escalation
  // has a further step (middle) and Next (right).
  const c = state.current;
  $("rapidWrap").hidden = !!c;
  $("endWrap").hidden = !c;
  $("more").disabled = !hasNextStep(c);
  $("deckInfo").textContent = ui("leftRapid", { s, d, u: Object.keys(state.log).length });
}

function renderPrompt() {
  const c = state.current, text = $("text"), who = $("who");
  if (!c) return;
  if (c.kind === "scene") return renderScene();
  if (c.kind === "game") return renderGame();
  $("game").hidden = true;
  const duo = c.entry.players === 2;
  who.textContent = players(c.entry.players)
    + (c.kind === "sequence" && c.step > 0 ? " · " + ui("heightenTimes", { n: c.step }) : "")
    + (c.fill ? " · " + ui("callback") : "");
  who.className = "who" + (duo ? " duo" : "");
  if (c.kind === "callback") {
    const [before, after] = say(c.entry.text).split("{character}");
    const name = document.createElement("span");
    name.className = "callback";
    name.textContent = c.fill;
    text.replaceChildren(before, name, after);
  } else {
    text.textContent = c.kind === "sequence" ? say(c.entry.steps[c.step]) : say(c.entry.text);
  }
  text.className = "text" + (duo ? " duo" : "");
  void text.offsetWidth;
  text.classList.add("fresh");
  renderLines();
  $("cueNo").textContent = cueText();
}

// --- actions ----------------------------------------------------------------------------
function draw(players) {
  const isCallback = new Set(state.deck.callbacks);
  const pool = regular(players).concat(callbackPool(players));
  if (!pool.length) return;
  const entry = pick(pool);
  const current = { entry, kind: entry.steps ? "sequence" : isCallback.has(entry) ? "callback" : "single", step: 0, fill: null };
  if (current.kind === "callback") {
    const c = pick(callbackCandidates());
    current.fill = say(c.entry.callback);
    state.usedFills.add(c.entry.id);
    state.seenCallbacks.add(entry.id);   // callback frames are reusable, so they are not logged as used
  } else {
    record(entry.id, "used");
  }
  state.current = current; state.cue += 1;
  if (entry.callback) state.played.push({ entry, cue: state.cue });
  dealLines();
  renderPrompt(); renderCounts();
  ding(); startTimer();
  keepAwake();
}

// Heighten: the next step of an escalation.
function further() {
  const c = state.current;
  if (!hasNextStep(c)) return;
  c.step += 1; state.cue += 1;
  renderPrompt(); renderCounts();
  ding(); startTimer();
}

// Skip: move on without playing what is on screen. A pure skip, not feedback: the prompt goes back
// in the pile (not dealt again this session) and a new one for the same number of players is dealt.
function skip() {
  const c = state.current;
  if (!c) return;
  if (c.kind !== "callback") unrecord(c.entry.id);
  state.passed.add(c.entry.id);
  next();
}

// --- lines under the prompt -------------------------------------------------------------
// Each prompt is dealt a few labelled lines from the shared words: caveats the host may offer, or
// not. They are inspiration, never rules stacked on the prompt. Words recur (never logged as used).
// Each kind has one slot; its refresh icon swaps it. Labels come from words/tags.json, by language.
// Rapid fire, two players: gimmicks aimed at the players (speech, staging, tempo), which can pile
// on for the fun of it. Scenes: character work (emotion, physical) and a way of speaking. Style is
// left out of scenes: setups carry their own tone, and a genre tends to clash with it.
const LINES = { duo: ["speech", "staging", "tempo"], scene: ["emotions", "physical", "speech"] };
const lineKinds = c => !c ? [] : c.kind === "scene" ? LINES.scene
  : c.kind !== "game" && c.entry.players === 2 ? LINES.duo : [];
const kindLabel = k => say(state.deck.kinds[k]?.label) || k;
function dealLines() {
  state.coaching = []; state.lastCoach = null;
  for (const kind of lineKinds(state.current)) dealCoach(kind);
  state.lastCoach = null;
}
function renderLines() {
  $("mods").hidden = !state.coaching.length;
  $("modList").replaceChildren(...state.coaching.map(x => {
    const li = kindLine(x.kind, x.entry.text, { coach: x.kind });
    li.className = "coach-line" + (x.kind === state.lastCoach ? " fresh" : "");
    return li;
  }));
}

// --- Scenes mode ------------------------------------------------------------------------
// A deliberate scene for 2-4 players: one setup, with lines the host can side-coach with.
const scenePool = players => state.deck.scenes.filter(e => e.players === players && !state.log[e.id] && !state.passed.has(e.id));
function coachPool(kind) {
  const open = state.deck[kind].filter(e => state.log[e.id]?.action !== "skipped");
  const fresh = open.filter(e => !state.seenCoach.has(e.id));
  if (fresh.length) return fresh;
  open.forEach(e => state.seenCoach.delete(e.id));  // the whole list has been dealt: start it over
  return open;
}

function renderSceneCounts() {
  const left = n => scenePool(n).length;
  for (const b of document.querySelectorAll("[data-players]")) b.disabled = left(+b.dataset.players) === 0;
  const inScene = state.current?.kind === "scene";
  // Choosing: a button per scene size. Playing: the buzzer (left) and Next.
  $("scenesWrap").hidden = inScene;
  $("endWrap").hidden = !inScene;
  $("back").hidden = !inScene;
  $("more").disabled = true;
  $("skip").hidden = !state.current;
  $("deckInfo").textContent = ui("leftScenes", { a: left(2), b: left(3), c: left(4) });
}

const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A labelled line: the kind ("Speech", "Emotion" …) in small capitals, then the text, then
// optionally a refresh icon whose data attributes say what it swaps.
function kindLine(kind, text, refresh) {
  const li = document.createElement("li"), label = document.createElement("span");
  label.className = "kind";
  label.textContent = kindLabel(kind);
  li.append(label, say(text));
  if (refresh) {
    const b = document.createElement("button");
    b.className = "refresh";
    Object.assign(b.dataset, refresh);
    b.setAttribute("aria-label", ui("newLine", { kind: kindLabel(kind).toLowerCase() }));
    b.innerHTML = REFRESH_ICON;
    li.append(b);
  }
  return li;
}
function renderScene(fresh) {
  const c = state.current, text = $("text"), who = $("who");
  $("game").hidden = true;
  who.textContent = ui("scene", { who: players(c.entry.players) });
  who.className = "who scene";
  text.textContent = say(c.entry.text);
  text.className = "text scene";
  if (fresh) { void text.offsetWidth; text.classList.add("fresh"); }
  renderLines();
  $("cueNo").textContent = cueText();
}

function drawScene(players = state.players) {
  state.players = players;
  const pool = scenePool(players);
  if (!pool.length) return;
  const entry = pick(pool);
  record(entry.id, "used");
  state.current = { entry, kind: "scene" }; state.cue += 1;
  dealLines();
  renderScene(true); renderSceneCounts();
  ding(); startTimer();
  keepAwake();
}

function dealCoach(kind) {
  const pool = coachPool(kind);
  if (!pool.length) return null;
  const entry = pick(pool);
  state.seenCoach.add(entry.id);
  state.coaching = state.coaching.filter(x => x.kind !== kind).concat({ kind, entry })
    .sort((a, b) => lineKinds(state.current).indexOf(a.kind) - lineKinds(state.current).indexOf(b.kind));
  state.lastCoach = kind;
  return entry;
}

// The refresh icon beside a line swaps only that line.
function coach(kind) {
  if (!dealCoach(kind)) return;
  renderPrompt(); renderCounts();
  ding();
}


// The card between prompts. Label and message are UI keys, kept so a language switch can redraw them.
let idleView = null;
function idle(label, message, vals) {
  idleView = { label, message, vals };
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

// Next: a new prompt or scene for the same number of players.
function next() {
  const c = state.current;
  if (!c) return;
  if (c.kind === "game") {
    state.current = null;
    drawGame();
  } else if (c.kind === "scene") {
    state.current = null;
    if (scenePool(state.players).length) drawScene();
    else idle("done", "noScenes", { n: state.players });
  } else {
    const players = c.entry.players;
    state.current = null;
    if (regular(players).length) draw(players);
    else idle("done", "noPrompts", { n: players });
  }
}

// Back: leave the prompt or scene and return to the player buttons.
function back() {
  state.current = null; state.coaching = []; state.lastCoach = null;
  idle("ready", READY[state.mode]);
}

function setMode(mode, quiet) {
  if (mode !== state.mode && state.current) state.current = null;
  state.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  const scenes = mode === "scenes", games = mode === "games";
  $("modeRapid").setAttribute("aria-pressed", String(mode === "rapid"));
  $("modeScenes").setAttribute("aria-pressed", String(scenes));
  $("modeGames").setAttribute("aria-pressed", String(games));
  $("rapidWrap").hidden = mode !== "rapid";
  $("scenesWrap").hidden = !scenes;
  $("gamesWrap").hidden = !games;
  document.body.classList.toggle("scenes-on", scenes);
  document.body.classList.toggle("games-on", games);
  $("next").setAttribute("aria-label", ui(games ? "nextGameAria" : "nextAria"));
  state.coaching = []; state.lastCoach = null;
  if (!quiet) idle("ready", READY[mode]);
}

// --- games ------------------------------------------------------------------------------
// A short-form game as a suggestion: dealt at random, never used up, not dealt again until the
// list has gone round. The suggestions it asks for come from the shared words.
function pickWord(kind, taken) {
  const pool = state.deck[kind].filter(e => !taken.has(e.id));
  return pool.length ? pick(pool) : null;
}
function drawGame() {
  let pool = state.deck.games.filter(g => !state.seenGames.has(g.id));
  if (!pool.length) { state.seenGames.clear(); pool = state.deck.games; }
  if (!pool.length) return;
  const entry = pick(pool);
  state.seenGames.add(entry.id);
  const taken = new Set();
  state.gameWords = (entry.asks || []).map(kind => {
    const w = pickWord(kind, taken);
    if (w) taken.add(w.id);
    return { kind, entry: w };
  }).filter(x => x.entry);
  state.current = { entry, kind: "game" }; state.cue += 1;
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
  ding();
}
function renderGame(fresh) {
  const g = state.current.entry, text = $("text"), who = $("who"), box = $("game");
  const { min, max } = g.players;
  who.textContent = ui("game", { range: min === max ? min : `${min}–${max}` });
  who.className = "who game";
  text.textContent = say(g.name);
  text.className = "text game-name";
  if (fresh) { void text.offsetWidth; text.classList.add("fresh"); }
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
    aka.textContent = ui("aka", { list: aliases.join(", ") });
    how.append(aka);
  }
  how.open = state.howOpen;
  how.addEventListener("toggle", () => { state.howOpen = how.open; });
  parts.push(how);
  box.replaceChildren(...parts);
  box.hidden = false;
  $("cueNo").textContent = cueText();
}
function renderGameCounts() {
  const inGame = state.current?.kind === "game";
  $("gamesWrap").hidden = inGame;
  $("endWrap").hidden = !inGame;
  $("back").hidden = !inGame;
  $("skip").hidden = true;   // nothing is used up, so Next is already a skip
  $("more").disabled = true;
  $("dealGame").disabled = !state.deck.games.length;
  $("deckInfo").textContent = ui("gamesCount", { n: state.deck.games.length });
}

// --- timer ------------------------------------------------------------------------------
// Optional, per tab: Off, 0:30, 1:00, 2:00 or 3:00. It restarts with every new prompt or step,
// counts down on its button and drains a bar along the card's bottom edge. At zero it
// turns red and waits: it never rings, so the buzzer stays the host's call.
const TIMER_STEPS = [0, 30, 60, 120, 180];
const TIMER_KEY = "imprompt-timer-";
const timer = { rapid: 0, scenes: 0, games: 0, end: 0, tick: null };
try { for (const m of ["rapid", "scenes", "games"]) { const v = +localStorage.getItem(TIMER_KEY + m); if (TIMER_STEPS.includes(v)) timer[m] = v; } } catch {}
const clock = secs => Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
function renderTimer() {
  const secs = timer[state.mode], b = $("timer"), bar = $("timebar");
  const running = !!timer.tick, left = running ? Math.max(0, Math.ceil((timer.end - Date.now()) / 1000)) : secs;
  b.querySelector(".label").textContent = secs ? clock(left) : ui("off");
  b.classList.toggle("on", !!secs);
  b.classList.toggle("done", running && left === 0);
  b.setAttribute("aria-label", secs ? ui("timerOn", { t: clock(secs) }) : ui("timerOff"));
  bar.hidden = !running;
  bar.classList.toggle("done", running && left === 0);
  if (running) bar.style.transform = `scaleX(${Math.max(0, (timer.end - Date.now()) / (secs * 1000))})`;
}
function startTimer() {
  stopTimer();
  const secs = timer[state.mode];
  if (!secs || !state.current) return renderTimer();
  timer.end = Date.now() + secs * 1000;
  timer.tick = setInterval(renderTimer, 200);
  renderTimer();
}
function stopTimer() { clearInterval(timer.tick); timer.tick = null; renderTimer(); }
function cycleTimer() {
  const m = state.mode;
  timer[m] = TIMER_STEPS[(TIMER_STEPS.indexOf(timer[m]) + 1) % TIMER_STEPS.length];
  try { localStorage.setItem(TIMER_KEY + m, String(timer[m])); } catch {}
  startTimer();
}

// --- sound ------------------------------------------------------------------------------
// Two recorded sounds (CC0, see CREDITS.md): one blop for every new prompt, whatever it is, and
// the buzzer that ends a scene. Each has a synthesised stand-in if its file can't be loaded.
let audio = null;
try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {}
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

// The same blop for every new prompt: a first prompt, a further step, a scene, a game, a refreshed
// line. Varying it by step was tried; a minute into a scene nobody hears the difference.
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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.current) keepAwake(); });

// --- start ------------------------------------------------------------------------------
for (const b of document.querySelectorAll("[data-rapid]")) b.addEventListener("click", () => draw(+b.dataset.rapid));
$("more").addEventListener("click", further);
$("bigBuzz").addEventListener("click", buzzer);
$("skip").addEventListener("click", skip);
$("reset").addEventListener("click", reset);
$("timer").addEventListener("click", cycleTimer);
$("next").addEventListener("click", next);
$("back").addEventListener("click", back);
$("mute").addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
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
  for (const b of document.querySelectorAll("[data-rapid]")) b.setAttribute("aria-label", ui("dealRapidAria", { who: players(+b.dataset.rapid) }));
  for (const b of document.querySelectorAll("[data-players]")) b.setAttribute("aria-label", ui("dealSceneAria", { who: players(+b.dataset.players) }));
  for (const el of document.querySelectorAll("[data-count]")) el.textContent = players(+el.dataset.count);
  document.documentElement.lang = lang;
}
$("lang").addEventListener("click", () => {
  lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  renderLang();
  if (state.current) { renderPrompt(); renderCounts(); }
  else if (idleView) idle(idleView.label, idleView.message, idleView.vals);
  else renderCounts();
  renderTimer(); renderMute();
  if (!$("reset").classList.contains("armed")) $("reset").textContent = ui("reset");
  $("cueNo").textContent = state.cue ? cueText() : ui("cue", { n: "—" });
});
renderLang();
for (const b of document.querySelectorAll("[data-players]")) b.addEventListener("click", () => drawScene(+b.dataset.players));
$("modList").addEventListener("click", e => { const b = e.target.closest(".refresh"); if (b) coach(b.dataset.coach); });
$("modeRapid").addEventListener("click", () => setMode("rapid"));
$("modeScenes").addEventListener("click", () => setMode("scenes"));
$("modeGames").addEventListener("click", () => setMode("games"));
$("dealGame").addEventListener("click", drawGame);
$("game").addEventListener("click", e => { const b = e.target.closest(".refresh"); if (b) refreshGameWord(+b.dataset.slot); });
try {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === "scenes" || saved === "games") state.mode = saved;
} catch {}

(async function start() {
  loadLog();
  $("deckInfo").textContent = ui("loading");
  $("cueNo").textContent = ui("cue", { n: "—" });
  $("reset").textContent = ui("reset");
  try {
    state.deck = { ...state.deck, ...await (await fetch("deck.json", { cache: "no-cache" })).json() };
  } catch {
    $("deckInfo").textContent = ui("loadFail");
    setStatus(ui("loadFailMsg"), true);
    return;
  }
  $("reset").disabled = false;
  setMode(state.mode, true);
  idle("ready", READY[state.mode]);
  renderCounts();
  renderTimer();
})();
