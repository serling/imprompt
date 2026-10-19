"use strict";

const LANGS = ["en", "no"];
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
    buzzer: "Buzzer", bell: "Bell", newPrompt: "New prompt", newScene: "New scene", newGame: "New game",
    scene: "Scene · {who}", game: "Game · {range} players",
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
    buzzer: "Buzzer", bell: "Bjelle", newPrompt: "Ny oppgave", newScene: "Ny scene", newGame: "Nytt spill",
    scene: "Scene · {who}", game: "Spill · {range} spillere",
    howTo: "Slik spiller dere", aka: "Kalles også: {list}.", newLine: "Ny: {kind}", gimmick: "Gimmick",
    tapClose: "Trykk for å lukke", showLine: "Vis {kind} på hele skjermen",
    timerAria: "Stoppeklokke {t}. Trykk for å starte på nytt.",
    soundOn: "Lyd på. Trykk for å dempe.", soundOff: "Lyd av. Trykk for å slå på.",
    langAria: "Språk: {lang}. Trykk for {other}.",
  },
};
const SYSTEM_KEY = "imprompt-system", HISTORY_KEY = "imprompt-history", SESSION_KEY = "imprompt-session";
const SESSION_IDLE = 6 * 3600e3;
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};
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
const GROUP_MIN = 2, GROUP_MAX = 5;

const $ = id => document.getElementById(id);
let lang = "en";
if (LANGS.includes(system.lang)) lang = system.lang;
const say = t => (t && (t[lang] || t.en)) || "";
const ui = (key, vals = {}) => String((UI[lang] && UI[lang][key]) ?? UI.en[key])
  .replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");
const players = n => n === 1 ? ui("p1") : ui("pN", { n });

const state = {
  mode: "rapid",
  players: 2,
  log: {},
  lastActive: null,
  group: null,
  current: null,
  cue: 0,
  shown: new Set(),
  coaching: [],
  lastCoach: null,
  seenCoach: new Set(),
  seenGames: new Set(),
  gameWords: [],
  howOpen: false,
};

function record(id, action) {
  state.log = { ...(store.get(HISTORY_KEY) || state.log), [id]: { action, at: new Date().toISOString() } };
  if (!store.set(HISTORY_KEY, state.log)) setStatus(ui("noSave"), true);
}
const SESSION_SETS = ["shown", "seenCoach", "seenGames"];
function saveSession() {
  if (!state.lastActive) return;
  const saved = { lastActive: state.lastActive, group: state.group, mode: state.mode, cue: state.cue };
  for (const k of SESSION_SETS) saved[k] = [...state[k]];
  store.set(SESSION_KEY, saved);
}
function touchSession() { state.lastActive = Date.now(); saveSession(); }
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
  for (const k of SESSION_SETS) state[k] = new Set(s[k] || []);
}
function clearSession() {
  store.remove(SESSION_KEY);
  Object.assign(state, { lastActive: null, group: null, current: null, cue: 0,
    coaching: [], lastCoach: null, gameWords: [] });
  for (const k of SESSION_SETS) state[k] = new Set();
}
function newSession() {
  clearSession();
  renderGroup();
  setMode("rapid", true);
  askGroup();
}
function checkSession() {
  if (!state.lastActive) return;
  const last = Math.max(state.lastActive, store.get(SESSION_KEY)?.lastActive || 0);
  if (expired(last)) newSession();
}
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
function renderReset() {
  const b = $("reset"), armed = b.classList.contains("armed");
  b.querySelector(".label").textContent = armed ? ui("resetArm") : "";
  b.setAttribute("aria-label", ui(armed ? "resetArm" : "reset"));
  b.title = ui("reset");
}
function setStatus(msg, warn) { $("status").textContent = msg; $("status").className = "status" + (warn ? " warn" : ""); }

const freshFirst = list => Deal.freshFirst(list, { shown: state.shown, log: state.log });
const regular = players => freshFirst(Content.prompts(players));
const pick = Deal.pick;

function renderCounts() {
  if (state.mode === "scenes") return renderSceneCounts();
  if (state.mode === "games") return renderGameCounts();
  $("dealRapid").disabled = !state.group || ![1, 2].some(n => regular(n).length);
}

function swapCard() {
  const card = $("card");
  card.classList.remove("swap", "buzzed", "belled");
  void card.offsetWidth;
  card.classList.add("swap");
}
function renderPrompt(fresh) {
  const c = state.current, text = $("text"), who = $("who");
  if (!c) return;
  if (c.kind === "scene") return renderScene(fresh);
  if (c.kind === "game") return renderGame(fresh);
  $("game").hidden = true;
  who.textContent = players(c.entry.players);
  who.className = "who rapid";
  text.textContent = say(c.entry.text);
  text.className = "text";
  if (fresh) swapCard();
  renderLines();
}

function drawRapid() {
  const counts = [1, 2].filter(n => regular(n).length > 0);
  if (!counts.length) { state.current = null; return idle("done", "noPrompts"); }
  draw(pick(counts));
}
function draw(players) {
  const pool = regular(players);
  if (!pool.length) return;
  const entry = pick(pool);
  record(entry.id, "used");
  state.shown.add(entry.id);
  state.current = { entry, kind: "single" }; state.cue += 1;
  dealLines();
  touchSession();
  renderPrompt(true); renderCounts();
  ding(); startTimer();
  keepAwake();
}

const GIMMICK = ["physical", "speech", "staging", "tempo"];
const SLOTS = {
  character: [["emotions"], ["wants"], ["secrets"]],
  opener: [[...GIMMICK, "firstlines"]],
};
const LINES = { scene: ["character", "opener"] };
const lineKinds = c => c?.kind === "scene" ? LINES.scene : [];
const askParts = Deal.askParts;
const kindLabel = spec => {
  if (spec === "gimmick") return ui("gimmick");
  const { kind, tags } = askParts(spec);
  return say(Content.label(kind, tags[0])) || kind;
};
function dealLines() {
  state.coaching = []; state.lastCoach = null;
  for (const slot of lineKinds(state.current)) dealCoach(slot);
  state.lastCoach = null;
}
function showLine(s) {
  $("revealKind").textContent = s.closest("li").querySelector(".kind").textContent;
  $("revealText").textContent = s.textContent.trim();
  $("reveal").hidden = false;
}
function hideLine() { $("reveal").hidden = true; }
function renderLines() {
  $("mods").hidden = !state.coaching.length;
  $("modList").replaceChildren(...state.coaching.map(x => {
    const li = kindLine(GIMMICK.includes(x.kind) ? "gimmick" : x.kind, x.entry.text, { coach: x.slot });
    li.className = "coach-line" + (x.slot === state.lastCoach ? " fresh" : "");
    return li;
  }));
}

const scenePool = () => freshFirst(Deal.scenesFor(Content.scenes(), state.group));
function coachPool(kind) {
  const { pool, spent } = Deal.linePool(Content.list(kind), { log: state.log, seen: state.seenCoach });
  spent.forEach(id => state.seenCoach.delete(id));
  return pool;
}

function renderSceneCounts() {
  $("dealScene").disabled = !scenePool().length;
}

const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function kindLine(kind, text, refresh) {
  const li = document.createElement("li"), label = document.createElement("span");
  label.className = "kind";
  label.textContent = kindLabel(kind);
  const words = say(text), body = document.createElement("span");
  body.className = "say";
  li.append(label, body);
  if (!refresh) { body.append(words); return li; }
  body.classList.add("show");
  body.setAttribute("role", "button");
  body.tabIndex = 0;
  body.setAttribute("aria-label", ui("showLine", { kind: kindLabel(kind).toLowerCase() }));
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
  const entry = Deal.pickScene(pool);
  record(entry.id, "used");
  state.shown.add(entry.id);
  state.current = { entry, kind: "scene" }; state.cue += 1;
  dealLines();
  touchSession();
  renderScene(true); renderSceneCounts();
  ding(); startTimer();
  keepAwake();
}

function dealCoach(slot) {
  const choice = Deal.pickLine(SLOTS[slot].map(g => g.flatMap(kind => coachPool(kind).map(entry => ({ kind, entry })))));
  if (!choice) return null;
  const { kind, entry } = choice;
  state.seenCoach.add(entry.id);
  state.coaching = state.coaching.filter(x => x.slot !== slot).concat({ slot, kind, entry })
    .sort((a, b) => lineKinds(state.current).indexOf(a.slot) - lineKinds(state.current).indexOf(b.slot));
  state.lastCoach = slot;
  return entry;
}

function coach(slot) {
  if (!dealCoach(slot)) return;
  renderLines();
  saveSession();
}

const PERSON_ICON = '<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><circle cx="12" cy="7" r="4.2" fill="currentColor"/><path d="M3.5 22c0-4.9 3.8-8.6 8.5-8.6s8.5 3.7 8.5 8.6z" fill="currentColor"/></svg>';
function groupText(n = state.group) { return n >= GROUP_MAX ? ui("pMore", { n: GROUP_MAX }) : players(n); }
function renderGroup() {
  const sel = $("group");
  const counts = Array.from({ length: GROUP_MAX - GROUP_MIN + 1 }, (_, i) => GROUP_MIN + i);
  sel.replaceChildren(...counts.map(n => new Option(groupText(n), n)));
  sel.value = state.group || "";
  sel.setAttribute("aria-label", ui("playersAria"));
  $("groupWrap").hidden = !state.group;
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

let idleView = null;
function idle(label, message, vals) {
  idleView = { label, message, vals };
  $("picker").hidden = message !== "askPlayers";
  document.querySelector(".controls").hidden = message === "askPlayers";
  document.body.classList.toggle("asking", message === "askPlayers");
  $("card").classList.toggle("asking", message === "askPlayers");
  $("who").textContent = ui(label);
  $("who").className = "who " + ({ rapid: "rapid", scenes: "scene", games: "game" }[state.mode] || "");
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

function pickWord(spec, taken) {
  const pool = Deal.wordsFor(Content.list(askParts(spec).kind), spec, taken);
  return pool.length ? pick(pool) : null;
}
const gamePool = () => Deal.gamesFor(Content.games(), state.group);
function drawGame() {
  const { pool, reset } = Deal.gamePool(gamePool(), state.seenGames);
  if (reset) state.seenGames.clear();
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

let audio = null;
try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
let muted = !!system.muted;
function renderMute() {
  $("mute").setAttribute("aria-pressed", String(muted));
  $("mute").setAttribute("aria-label", ui(muted ? "soundOff" : "soundOn"));
}

const recordings = {};
for (const name of ["blop", "buzzer", "bell"]) {
  recordings[name] = {};
  fetch(`sounds/${name}.mp3`).then(r => r.ok ? r.arrayBuffer() : null).then(b => { recordings[name].file = b; }).catch(() => {});
}
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

async function ding() {
  if (muted) return;
  if (!(await play("blop"))) synthDing();
}

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

async function buzzer() {
  const card = $("card");
  card.classList.remove("buzzed");
  void card.offsetWidth;
  card.classList.add("buzzed");
  if (muted) return;
  if (!(await play("buzzer"))) synthBuzzer();
}

async function bell() {
  const card = $("card");
  card.classList.remove("belled");
  void card.offsetWidth;
  card.classList.add("belled");
  if (muted) return;
  if (!(await play("bell"))) synthBell();
}

function synthBell() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime, out = audio.createGain();
    out.connect(audio.destination);
    out.gain.value = 0.42;
    for (const [ratio, level, decay] of [[1, 1, 3.2], [2, 0.5, 2.4], [2.76, 0.4, 1.6], [4.07, 0.22, 1], [5.4, 0.15, 0.6]]) {
      const osc = audio.createOscillator(), env = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = 880 * ratio;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(level, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  } catch {}
}

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
window.addEventListener("pageshow", e => { if (e.persisted) checkSession(); });

for (const b of document.querySelectorAll(".buzz")) b.addEventListener("click", buzzer);
for (const b of document.querySelectorAll(".bell")) b.addEventListener("click", bell);
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
  if (s) showLine(s);
});
for (const id of ["modList", "game"]) $(id).addEventListener("keydown", e => {
  const s = e.target.closest(".say.show");
  if (s && !e.target.closest(".refresh") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showLine(s); }
});
$("reveal").addEventListener("click", hideLine);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("reveal").hidden) hideLine(); });
$("modeRapid").addEventListener("click", () => setMode("rapid"));
$("modeScenes").addEventListener("click", () => setMode("scenes"));
$("modeGames").addEventListener("click", () => setMode("games"));
$("dealGame").addEventListener("click", drawGame);
$("game").addEventListener("click", e => {
  const b = e.target.closest(".refresh");
  if (b) return refreshGameWord(+b.dataset.slot);
  const s = e.target.closest(".say.show");
  if (s) showLine(s);
});

(async function start() {
  state.log = store.get(HISTORY_KEY) || {};
  renderReset();
  try {
    await Content.load();
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
