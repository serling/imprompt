// Imprompt player. One prompt at a time; nothing repeats on this device.
// Data: deck.json, built from prompts/ by tools/build.py. Language: English.
"use strict";

const LANG = "en";
const LOG_KEY = "imprompt-log";
const MUTE_KEY = "imprompt-muted";
const MAX_MODS = 2;          // a duo scene can be rerun twice, stacking modifiers
const MIN_CALLBACK_GAP = 3;  // a callback names a character played at least this many cues ago

const $ = id => document.getElementById(id);
const say = t => (t && t[LANG]) || "";

const state = {
  deck: { solo: [], duo: [], escalations: [], callbacks: [], modifiers: [] },
  log: {},            // id -> { action: "used" | "skipped", at }
  current: null,      // { entry, kind: "single" | "sequence" | "callback", step, fill }
  cue: 0,
  stack: [],          // modifiers on the current duo rerun
  seenMods: new Set(), seenCallbacks: new Set(), usedFills: new Set(),
  played: [],         // { entry, cue } for characters that can be called back (this session only)
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
function setStatus(msg, warn) { $("status").textContent = msg; $("status").className = "status" + (warn ? " warn" : ""); }

// --- pools ------------------------------------------------------------------------------
const regular = players => [...(players === 1 ? state.deck.solo : state.deck.duo), ...state.deck.escalations]
  .filter(e => e.players === players && !state.log[e.id]);
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
  const s = regular(1).length, d = regular(2).length;
  $("solo").disabled = s === 0;
  $("duo").disabled = d === 0;
  $("skip").disabled = !state.current;
  const c = state.current;
  const further = hasNextStep(c) ? c.entry.players : canRerun(c) ? 2 : 0;
  for (const [k, n] of [["solo", 1], ["duo", 2]]) {
    $(k + "More").hidden = further !== n;
    $(k + "Wrap").classList.toggle("open", further === n);
  }
  const counted = Object.values(state.log);
  const skipped = counted.filter(x => x.action === "skipped").length;
  $("deckInfo").textContent = `Solo ${s} · Duo ${d} left · ${counted.length - skipped} used · ${skipped} skipped`;
}

function renderPrompt() {
  const c = state.current, text = $("text"), who = $("who");
  if (!c) return;
  const duo = c.entry.players === 2;
  who.textContent = (duo ? "Duo" : "Solo")
    + (c.kind === "sequence" && c.step > 0 ? " · Further ×" + (c.step + 1) : "")
    + (c.fill ? " · Callback" : "")
    + (state.stack.length ? " · Escalate ×" + state.stack.length : "");
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
    ding(c.step + 1);
  } else if (canRerun(c)) {
    const m = pickMod();
    state.stack.push(m); state.seenMods.add(m.id); state.cue += 1;
    renderPrompt(); renderCounts();
    ding(1, state.stack.length);
  }
}

function skip() {
  const c = state.current;
  if (!c) return;
  if (state.stack.length) {
    // On a rerun, Skip rejects only the newest modifier and deals another in its place.
    record(state.stack.pop().id, "skipped");
    const m = pickMod();
    if (m) { state.stack.push(m); state.seenMods.add(m.id); }
    renderPrompt(); renderCounts();
    return;
  }
  record(c.entry.id, "skipped");
  state.current = null;
  const players = c.entry.players;
  if (regular(players).length) draw(players);
  else {
    $("who").textContent = "Skipped";
    $("text").textContent = `No ${players === 1 ? "solo" : "duo"} prompts left.`;
    $("text").className = "text idle";
    renderCounts();
  }
}

// --- sound ------------------------------------------------------------------------------
// A playful two-note "bl-ing", synthesised (no sound file). level = escalation step: more
// strikes, higher. deeper > 0: one bling, a fourth lower per level (duo rerun).
let audio = null;
try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {}
function renderMute() {
  $("mute").setAttribute("aria-pressed", String(muted));
  $("mute").setAttribute("aria-label", muted ? "Sound off. Tap to unmute." : "Sound on. Tap to mute.");
}
function ding(level = 1, deeper = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const strikes = deeper ? 1 : Math.min(level, 5), out = audio.createGain();
    out.gain.value = 0.45 / (1 + 0.35 * (strikes - 1)); // overlapping strikes would clip
    out.connect(audio.destination);
    const note = (t, freq) => {
      // Short tail and in-tune overtones only: no ring-out, no metallic clang.
      for (const [ratio, gain, decay] of [[1, 1, 0.45], [2, 0.12, 0.22]]) {
        const osc = audio.createOscillator(), env = audio.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * ratio * 0.9, t);
        osc.frequency.exponentialRampToValueAtTime(freq * ratio, t + 0.05);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(env).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.05);
      }
    };
    for (let k = 0; k < strikes; k++) {
      const t = audio.currentTime + k * 0.17;
      const freq = deeper ? 784 * Math.pow(0.75, deeper) : 784 * Math.pow(1.122, level - 1 + k * 0.5);
      note(t, freq);
      note(t + 0.07, freq * 1.26);
    }
  } catch {}
}

// The buzzer that ends a scene: a recorded game-show buzzer (sounds/buzzer.mp3, CC0, see
// CREDITS.md). If the recording can't be loaded, a synthesised buzz stands in. Respects mute;
// the card flashes either way so the room sees the scene end.
let buzzerFile = null, buzzerBuffer = null;
fetch("sounds/buzzer.mp3").then(r => r.ok ? r.arrayBuffer() : null).then(b => { buzzerFile = b; }).catch(() => {});

async function buzzer() {
  const card = $("card");
  card.classList.remove("buzzed");
  void card.offsetWidth;
  card.classList.add("buzzed");
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    if (!buzzerBuffer && buzzerFile) buzzerBuffer = await audio.decodeAudioData(buzzerFile.slice(0));
    if (buzzerBuffer) {
      const src = audio.createBufferSource();
      src.buffer = buzzerBuffer;
      src.connect(audio.destination);
      src.start();
      return;
    }
  } catch {}
  synthBuzzer();
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
$("solo").addEventListener("click", () => draw(1));
$("duo").addEventListener("click", () => draw(2));
$("soloMore").addEventListener("click", further);
$("duoMore").addEventListener("click", further);
$("skip").addEventListener("click", skip);
$("buzz").addEventListener("click", buzzer);
$("mute").addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
  renderMute();
});
renderMute();

(async function start() {
  loadLog();
  try {
    state.deck = await (await fetch("deck.json", { cache: "no-cache" })).json();
  } catch {
    $("deckInfo").textContent = "Deck failed to load";
    setStatus("The prompts couldn't be loaded. Check the connection and reload.", true);
    return;
  }
  renderCounts();
})();
