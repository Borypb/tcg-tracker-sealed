// Script 9 — noms des Pokémon dans toutes les langues des cartes (PokéAPI, données publiques), pour la recherche
// de l'app : « Pikachu » trouve ピカチュウ, « Dracaufeu » trouve Charizard ou リザードン.
// Sortie : cards/pokemon-names.json  { langs: [...], names: [[en, fr, de, es, it, ja, ko, zh, zh-cn], …] }
import { getText, writeJson } from "./lib.mjs";

const CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";
// identifiants de langue PokéAPI (languages.csv) → langue des cartes de l'app
const LANGS = [
  ["en", 9],
  ["fr", 5],
  ["de", 6],
  ["es", 7],
  ["it", 8],
  ["ja", 1], // katakana, comme sur les cartes
  ["ko", 3],
  ["zh", 4], // traditionnel
  ["zh-cn", 12] // simplifié
];

/** une ligne CSV (les noms ne contiennent pas de guillemets doublés, mais certains sont entre guillemets) */
function split(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function pokemonNames() {
  const rows = (await getText(CSV)).split(/\r?\n/).slice(1).filter(Boolean).map(split);
  const bySpecies = new Map();
  for (const [species, lang, name] of rows) {
    const m = bySpecies.get(species) ?? new Map();
    m.set(Number(lang), name);
    bySpecies.set(species, m);
  }
  const names = [...bySpecies.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, m]) => LANGS.map(([, id]) => m.get(id) ?? m.get(9) ?? ""))
    .filter((r) => r[0]);
  await writeJson("cards/pokemon-names.json", { langs: LANGS.map(([l]) => l), names });
  console.log(`noms des Pokémon : ${names.length} espèces, ${LANGS.length} langues`);
}

if (import.meta.url === `file://${process.argv[1]}`) await pokemonNames();
