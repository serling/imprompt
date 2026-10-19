const Deal = (() => {
  const SCENE_WEIGHT = { 2: 6, 3: 2.5, 4: 1.5 };

  const pick = (list, random = Math.random) => list[Math.floor(random() * list.length)];

  const askParts = spec => {
    const [kind, narrow = ""] = spec.split(":");
    return { kind, tags: narrow.split("+").filter(Boolean) };
  };

  function freshFirst(list, { shown, log }) {
    const open = list.filter(e => !shown.has(e.id) && log[e.id]?.action !== "skipped");
    const unseen = open.filter(e => !log[e.id]);
    if (unseen.length) return unseen;
    open.sort((a, b) => (log[a.id].at || "").localeCompare(log[b.id].at || ""));
    return open.slice(0, Math.ceil(open.length / 5));
  }

  const promptsFor = (deck, players) => (players === 1 ? deck.solo : deck.duo).filter(e => e.players === players);

  const scenesFor = (scenes, group) => scenes.filter(e => e.players <= (group || 0));

  function pickScene(pool, random = Math.random, weights = SCENE_WEIGHT) {
    const counts = [...new Set(pool.map(e => e.players))];
    let r = random() * counts.reduce((s, n) => s + weights[n], 0);
    const n = counts.find(c => (r -= weights[c]) < 0) ?? counts[0];
    return pick(pool.filter(e => e.players === n), random);
  }

  function linePool(entries, { log, seen }) {
    const open = entries.filter(e => log[e.id]?.action !== "skipped");
    const fresh = open.filter(e => !seen.has(e.id));
    return fresh.length ? { pool: fresh, spent: [] } : { pool: open, spent: open.map(e => e.id) };
  }

  function pickLine(groups, random = Math.random) {
    const filled = groups.filter(g => g.length);
    if (!filled.length) return null;
    return pick(pick(filled, random), random);
  }

  function wordsFor(entries, spec, taken) {
    const { tags } = askParts(spec);
    return entries.filter(e => !taken.has(e.id) && tags.every(t => (e.tags || []).includes(t)));
  }

  const gamesFor = (games, group) => games.filter(g => g.players.min <= (group || 0));

  function gamePool(fits, seen) {
    const fresh = fits.filter(g => !seen.has(g.id));
    return fresh.length ? { pool: fresh, reset: false } : { pool: fits, reset: true };
  }

  return { SCENE_WEIGHT, pick, askParts, freshFirst, promptsFor, scenesFor, pickScene, linePool, pickLine, wordsFor, gamesFor, gamePool };
})();
