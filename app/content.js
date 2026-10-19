const Content = (() => {
  let deck = { solo: [], duo: [], scenes: [], games: [], kinds: {}, tags: {} };

  async function load() {
    deck = { ...deck, ...await (await fetch("deck.json", { cache: "no-cache" })).json() };
  }

  const prompts = players => (players === 1 ? deck.solo : deck.duo).filter(e => e.players === players);
  const scenes = () => deck.scenes;
  const games = () => deck.games;
  const list = kind => deck[kind] || [];
  const label = (kind, tag) => (tag && deck.tags?.[tag]?.label) || deck.kinds[kind]?.label;
  const folderOf = entry => ["solo", "duo", "scenes", "games"].find(k => deck[k].includes(entry))
    || Object.keys(deck.kinds).find(k => list(k).includes(entry));

  return { load, prompts, scenes, games, list, label, folderOf };
})();
