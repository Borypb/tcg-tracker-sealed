// Script 7 — versions qui existent vraiment pour chaque carte Pokémon (normale, holo, reverse, motifs Poké Ball…),
// d'après le catalogue TCGplayer (TCGCSV) : TCGdex ne renseigne parfois que la version normale des
// extensions récentes. Correspondance des extensions TCGdex ↔ groupes TCGplayer : champ thirdParty.tcgplayer
// des fichiers d'extension de la base TCGdex (github.com/tcgdex/cards-database), puis cartes par numéro.
// Catalogue américain : versions anglaises, qui valent aussi pour les éditions internationales (fr, de…).
// Sortie : cards/pokemon-variants.json  { updatedAt, sets: { <id TCGdex>: { <numéro>: "NHRPM1" } } }
//   N normale · H holo · R reverse · P reverse Poké Ball · M reverse Master Ball · 1 1re édition
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getJson, writeJson } from "./lib.mjs";

const TCGCSV = "https://tcgcsv.com/tcgplayer";
const REPO = "https://github.com/tcgdex/cards-database.git";
const DIR = process.env.TCGDEX_DB ?? "/tmp/tcgdex-cards-database";

/** extensions TCGdex : id → groupe TCGplayer (s'il est renseigné) et nom anglais */
function tcgdexSets() {
  if (!existsSync(DIR)) execFileSync("git", ["clone", "--depth", "1", "--quiet", REPO, DIR], { stdio: "inherit" });
  const out = new Map();
  const data = join(DIR, "data");
  for (const serie of readdirSync(data, { withFileTypes: true })) {
    if (!serie.isDirectory()) continue;
    for (const f of readdirSync(join(data, serie.name))) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(data, serie.name, f), "utf8");
      const id = src.match(/\bid:\s*["']([^"']+)["']/)?.[1];
      const group = src.match(/thirdParty:\s*\{[^}]*tcgplayer:\s*(\d+)/)?.[1];
      const en = src.match(/name:\s*\{[^}]*\ben:\s*["']([^"']+)["']/)?.[1];
      if (id) out.set(id, { group: group ? Number(group) : undefined, en });
    }
  }
  return out;
}

const field = (p, name) => (p.extendedData ?? []).find((x) => x.name === name)?.value;

/** code des versions d'un produit : finitions vendues + motif indiqué dans le nom */
function codes(product, subs) {
  const name = product.name ?? "";
  const pattern = /master ?ball/i.test(name) ? "M" : /pok[eé] ?ball/i.test(name) ? "P" : "";
  const out = new Set();
  for (const s of subs) {
    if (pattern) out.add(pattern);
    else if (/reverse/i.test(s)) out.add("R");
    else if (/1st edition/i.test(s)) out.add("1");
    else if (/holo/i.test(s)) out.add("H");
    else if (/normal|unlimited/i.test(s)) out.add("N");
  }
  return out;
}

/** « 002/128 » → « 2 » ; « TG01/TG30 » → « TG01 » ; « SV001 » → « SV001 » */
const numKey = (n) => {
  const head = String(n ?? "").split("/")[0].trim();
  return /^\d+$/.test(head) ? String(Number(head)) : head.toUpperCase();
};

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");

export async function pokemonVariants() {
  const sets = tcgdexSets();
  // extensions sans groupe renseigné (les plus récentes) : groupe TCGplayer du même nom anglais (« ME: 30th Celebration »)
  const groups = (await getJson(`${TCGCSV}/3/groups`)).results ?? [];
  const byName = new Map();
  for (const g of groups) {
    const bare = norm(String(g.name).replace(/^[A-Z&]{1,6}\d*\s*[:-]\s*/, ""));
    byName.set(bare, [...(byName.get(bare) ?? []), g.groupId]);
  }
  const byGroup = new Map();
  let guessed = 0;
  for (const [id, s] of sets) {
    let g = s.group;
    if (!g && s.en) {
      const hits = byName.get(norm(s.en)) ?? [];
      if (hits.length === 1) {
        g = hits[0];
        guessed++;
      }
    }
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  }
  console.log(`versions Pokémon : ${byGroup.size} groupes TCGplayer (${guessed} retrouvés par le nom), ${sets.size} extensions TCGdex`);
  const out = {};
  let done = 0;
  for (const [group, ids] of byGroup) {
    try {
      const products = (await getJson(`${TCGCSV}/3/${group}/products`, { delay: 120 })).results ?? [];
      const prices = (await getJson(`${TCGCSV}/3/${group}/prices`, { delay: 120 })).results ?? [];
      const subs = new Map();
      for (const r of prices) subs.set(r.productId, [...(subs.get(r.productId) ?? []), r.subTypeName]);
      const cards = {};
      for (const p of products) {
        const n = field(p, "Number");
        if (!n) continue;
        const k = numKey(n);
        const set = new Set([...(cards[k] ?? ""), ...codes(p, subs.get(p.productId) ?? [])]);
        cards[k] = [...set].join("");
      }
      for (const id of ids) out[id] = cards;
    } catch (e) {
      console.warn(`groupe ${group} (${ids.join(", ")}) : ${e.message}`);
    }
    if (++done % 50 === 0) console.log(`versions Pokémon : ${done}/${byGroup.size} groupes`);
  }
  await writeJson("cards/pokemon-variants.json", { updatedAt: new Date().toISOString().slice(0, 10), sets: out });
  console.log(`versions Pokémon : ${Object.keys(out).length} extensions TCGdex`);
}

if (import.meta.url === `file://${process.argv[1]}`) await pokemonVariants();
