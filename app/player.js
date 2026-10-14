// Imprompt player. One prompt at a time; nothing repeats on this device.
// Data: deck.json, built from prompts/ by tools/build.py. Language: English.
"use strict";

const LANG = "en";
const LOG_KEY = "imprompt-log";
const MUTE_KEY = "imprompt-muted";
const MODE_KEY = "imprompt-mode";       // "rapid" | "scenes"
const MAX_MODS = 2;          // a duo scene can be rerun twice, stacking modifiers
const MIN_CALLBACK_GAP = 3;  // a callback names a character played at least this many cues ago

const $ = id => document.getElementById(id);
const say = t => (t && t[LANG]) || "";

const state = {
  deck: { solo: [], duo: [], escalations: [], callbacks: [], modifiers: [], scenes: [], emotions: [], styles: [] },
  mode: "rapid",
  players: 2,         // size of the scene on screen in Scenes mode
  log: {},            // id -> { action: "used", at } (older logs may also hold "skipped")
  passed: new Set(),  // prompts skipped this session: back in the pile, but not dealt again until a reload
  current: null,      // { entry, kind: "single" | "sequence" | "callback", step, fill }
  cue: 0,
  stack: [],          // modifiers on the current duo rerun
  seenMods: new Set(), seenCallbacks: new Set(), usedFills: new Set(),
  played: [],         // { entry, cue } for characters that can be called back (this session only)
  coaching: [],       // { kind, entry } side-coaching on screen: one slot per kind, the latest replaces the last
  lastCoach: null,    // the kind dealt most recently (Skip replaces it)
  seenCoach: new Set(),
};

// --- storage (this device only) ---------------------------------------------------------
function loadLog() {
  try { state.log = JSON.parse(localStorage.getItem(LOG_KEY) || "{}"); } catch { state.log = {}; }
}
function record(id, action) {
  state.log[id] = { action, at: new Date().toISOString() };
  try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log)); }
  catch { setStatus("This browser isn't saving, so prompts may repeat after a reload.", true); }
}
// Reset: forget every used prompt on this device, so the whole deck comes back.
// Two taps, since the page can't show a confirm dialog: the first arms it for a few seconds.
let resetTimer = null;
function reset() {
  const b = $("reset");
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = "Tap again to reset";
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  state.log = {};
  try { localStorage.removeItem(LOG_KEY); } catch {}
  state.current = null; state.cue = 0; state.stack = []; state.played = []; state.passed.clear();
  state.coaching = []; state.lastCoach = null;
  for (const seen of [state.seenMods, state.seenCallbacks, state.usedFills, state.seenCoach]) seen.clear();
  $("cueNo").textContent = "Cue —";
  idle("Reset", state.mode === "scenes" ? READY_SCENES : READY_RAPID);
}
function disarmReset() {
  clearTimeout(resetTimer);
  $("reset").classList.remove("armed"); $("reset").textContent = "Reset";
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
function pickMod() {
  const kinds = state.stack.map(m => m.kind);
  const pool = state.deck.modifiers.filter(m => !kinds.includes(m.kind) && !state.seenMods.has(m.id)
    && state.log[m.id]?.action !== "skipped");
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
const hasNextStep = c => !!c && c.kind === "sequence" && c.step < c.entry.steps.length - 1;
const canRerun = c => !!c && c.entry.players === 2 && c.kind !== "sequence" && state.stack.length < MAX_MODS && !!pickMod();
const pick = list => list[Math.floor(Math.random() * list.length)];

// --- rendering --------------------------------------------------------------------------
function renderCounts() {
  if (state.mode === "scenes") return renderSceneCounts();
  const s = regular(1).length, d = regular(2).length;
  for (const b of document.querySelectorAll("[data-rapid]")) b.disabled = regular(+b.dataset.rapid).length === 0;
  $("skip").hidden = !state.current;
  $("back").hidden = !state.current;
  // Choosing: a button per player count. Playing: the buzzer (left), » Heighten when the prompt can
  // go further (middle) and Next (right).
  const c = state.current, kind = hasNextStep(c) ? "step" : canRerun(c) ? "rerun" : "";
  $("rapidWrap").hidden = !!c;
  $("endWrap").hidden = !c;
  $("more").disabled = !kind;
  $("more").setAttribute("aria-label", kind === "rerun" ? "Heighten: rerun with a modifier" : "Heighten: next step");
  $("deckInfo").textContent = `Left · 1p ${s} · 2p ${d} · ${Object.keys(state.log).length} used`;
}

function renderPrompt() {
  const c = state.current, text = $("text"), who = $("who");
  if (!c) return;
  if (c.kind === "scene") return renderScene();
  const duo = c.entry.players === 2;
  who.textContent = (duo ? "2 players" : "1 player")
    + (c.kind === "sequence" && c.step > 0 ? " · Heighten ×" + c.step : "")
    + (c.fill ? " · Callback" : "")
    + (state.stack.length ? " · Heighten ×" + state.stack.length : "");
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
  $("mods").hidden = !state.stack.length;
  $("modList").replaceChildren(...state.stack.map(m => { const li = document.createElement("li"); li.textContent = say(m.text); return li; }));
  $("cueNo").textContent = "Cue " + String(state.cue).padStart(3, "0");
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
  state.current = current; state.cue += 1; state.stack = [];
  if (entry.callback) state.played.push({ entry, cue: state.cue });
  renderPrompt(); renderCounts();
  ding();
  keepAwake();
}

function further() {
  const c = state.current;
  if (hasNextStep(c)) {
    c.step += 1; state.cue += 1;
    renderPrompt(); renderCounts();
    ding();
  } else if (canRerun(c)) {
    const m = pickMod();
    state.stack.push(m); state.seenMods.add(m.id); state.cue += 1;
    renderPrompt(); renderCounts();
    ding();
  }
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

// --- Scenes mode ------------------------------------------------------------------------
// A deliberate scene for 2-4 players: one setup, then the host side-coaches while it runs.
// Emotions and styles are a vocabulary that may recur in later sessions (not logged as used).
// Each kind has one slot on screen; a new one replaces the old, so the card never grows a log.
const COACH_LABEL = { emotions: "Emotion", styles: "Style" };
const COACH_ORDER = Object.keys(COACH_LABEL);
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
  // Choosing: a button per scene size. Playing: the buzzer (left) and Next (right); the middle
  // slot, Heighten in Rapid fire, stays empty so both sit where they do there.
  $("scenesWrap").hidden = inScene;
  $("endWrap").hidden = !inScene;
  $("back").hidden = !inScene;
  $("more").disabled = true;
  $("skip").hidden = !state.current;
  $("deckInfo").textContent = `Scenes left · 2p ${left(2)} · 3p ${left(3)} · 4p ${left(4)}`;
}

const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function renderScene(fresh) {
  const c = state.current, text = $("text"), who = $("who");
  who.textContent = `Scene · ${c.entry.players} players`;
  who.className = "who scene";
  text.textContent = say(c.entry.text);
  text.className = "text scene";
  if (fresh) { void text.offsetWidth; text.classList.add("fresh"); }
  $("mods").hidden = !state.coaching.length;
  $("modList").replaceChildren(...state.coaching.map(x => {
    const li = document.createElement("li"), kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = COACH_LABEL[x.kind];
    const refresh = document.createElement("button");
    refresh.className = "refresh";
    refresh.dataset.coach = x.kind;
    refresh.setAttribute("aria-label", "New " + COACH_LABEL[x.kind].toLowerCase());
    refresh.innerHTML = REFRESH_ICON;
    li.append(kind, say(x.entry.text), refresh);
    li.className = "coach-line" + (x.kind === state.lastCoach ? " fresh" : "");
    return li;
  }));
  $("cueNo").textContent = "Cue " + String(state.cue).padStart(3, "0");
}

function drawScene(players = state.players) {
  state.players = players;
  const pool = scenePool(players);
  if (!pool.length) return;
  const entry = pick(pool);
  record(entry.id, "used");
  state.current = { entry, kind: "scene" }; state.cue += 1; state.coaching = []; state.lastCoach = null;
  // Every scene comes with an emotion and a style: the host uses them now, later, or not at all.
  for (const kind of COACH_ORDER) dealCoach(kind);
  state.lastCoach = null;
  renderScene(true); renderSceneCounts();
  ding();
  keepAwake();
}

function dealCoach(kind) {
  const pool = coachPool(kind);
  if (state.current?.kind !== "scene" || !pool.length) return null;
  const entry = pick(pool);
  state.seenCoach.add(entry.id);
  state.coaching = state.coaching.filter(x => x.kind !== kind).concat({ kind, entry })
    .sort((a, b) => COACH_ORDER.indexOf(a.kind) - COACH_ORDER.indexOf(b.kind));
  state.lastCoach = kind;
  return entry;
}

// The refresh icon beside an emotion or a style swaps only that line.
function coach(kind) {
  if (!dealCoach(kind)) return;
  renderScene(); renderSceneCounts();
  ding();
}


function idle(label, message) {
  $("who").textContent = label;
  $("who").className = "who";
  $("text").textContent = message;
  $("text").className = "text idle";
  $("mods").hidden = true;
  renderCounts();
}

const READY_RAPID = "Tap a player count for the next prompt.";
const READY_SCENES = "Tap a player count to start a scene.";

// Next: a new prompt or scene for the same number of players.
function next() {
  const c = state.current;
  if (!c) return;
  if (c.kind === "scene") {
    state.current = null;
    if (scenePool(state.players).length) drawScene();
    else idle("Done", `No ${state.players}-player scenes left.`);
  } else {
    const players = c.entry.players;
    state.current = null; state.stack = [];
    if (regular(players).length) draw(players);
    else idle("Done", `No ${players}-player prompts left.`);
  }
}

// Back: leave the prompt or scene and return to the player buttons.
function back() {
  state.current = null; state.stack = []; state.coaching = []; state.lastCoach = null;
  idle("Ready", state.mode === "scenes" ? READY_SCENES : READY_RAPID);
}

function setMode(mode, quiet) {
  if (mode !== state.mode && state.current) state.current = null;
  state.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  const scenes = mode === "scenes";
  $("modeRapid").setAttribute("aria-pressed", String(!scenes));
  $("modeScenes").setAttribute("aria-pressed", String(scenes));
  $("rapidWrap").hidden = scenes;
  $("scenesWrap").hidden = !scenes;
  document.body.classList.toggle("scenes-on", scenes);
  state.stack = []; state.coaching = []; state.lastCoach = null;
  if (!quiet) idle("Ready", scenes ? READY_SCENES : READY_RAPID);
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
  $("mute").setAttribute("aria-label", muted ? "Sound off. Tap to unmute." : "Sound on. Tap to mute.");
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

// The same blop for every new prompt: a first prompt, a further step, a rerun, a scene, a coaching
// word. Varying it by step was tried; a minute into a scene nobody hears the difference.
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
$("next").addEventListener("click", next);
$("back").addEventListener("click", back);
$("mute").addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
  renderMute();
});
renderMute();
for (const b of document.querySelectorAll("[data-players]")) b.addEventListener("click", () => drawScene(+b.dataset.players));
$("modList").addEventListener("click", e => { const b = e.target.closest(".refresh"); if (b) coach(b.dataset.coach); });
$("modeRapid").addEventListener("click", () => setMode("rapid"));
$("modeScenes").addEventListener("click", () => setMode("scenes"));
try {
  if (localStorage.getItem(MODE_KEY) === "scenes") state.mode = "scenes";
} catch {}

(async function start() {
  loadLog();
  try {
    state.deck = { ...state.deck, ...await (await fetch("deck.json", { cache: "no-cache" })).json() };
  } catch {
    $("deckInfo").textContent = "Deck failed to load";
    setStatus("The prompts couldn't be loaded. Check the connection and reload.", true);
    return;
  }
  $("reset").disabled = false;
  setMode(state.mode, state.mode === "rapid");
  renderCounts();
})();
