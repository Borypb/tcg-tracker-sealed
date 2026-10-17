// Script 10 — cartes Dragon Ball Super Fusion World en japonais, chinois traditionnel et thaï, depuis le site
// officiel (dbs-cardgame.com/fw) : le catalogue TCGplayer n'a que l'anglais. Le site n'a pas d'édition française.
// Une page par produit liste ses cartes : numéro, nom, illustration (parallèles « _p1 », recto de leader « _f »).
// Le nom anglais et la rareté viennent du catalogue anglais (même numéro, « FB01-001 »).
// Sortie : cards/dragonball-<langue>/index.json, <produit>.json, names.json
import { createHash } from "node:crypto";
import { readJson, sleep, writeJson } from "./lib.mjs";

const SITE = "https://www.dbs-cardgame.com";
const UA = "Mozilla/5.0 (compatible; Thothectio-catalog/1.0; +https://github.com/Borypb/thothectio-sealed)";
const REGIONS = [
  { lang: "ja", path: "jp" },
  { lang: "zh", path: "asia-tc" },
  { lang: "th", path: "asia-th" }
];

async function get(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

const hash = (x) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 12);
const clean = (s) =>
  (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** produits du menu de recherche : identifiant, nom, code (« FB04 ») */
function products(html) {
  const seen = new Map();
  for (const [, id, label] of html.matchAll(/data-val="(\d{6})"[^>]*>([^<]+)</g)) {
    if (seen.has(id)) continue;
    const name = clean(label);
    seen.set(id, { id, name, code: name.match(/[[【]([A-Z]{1,4}\d{1,3}[A-Z]?)[\]】]/)?.[1] });
  }
  return [...seen.values()];
}

/** cartes d'un produit : une ligne « cardItem » par impression */
function parseCards(html, base) {
  const out = [];
  for (const m of html.matchAll(/<li class="cardItem">([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const number = li.match(/card_no=([A-Z0-9-]+)/)?.[1];
    if (!number) continue;
    const variant = li.match(/[?&]p=_?([a-z0-9]+)/i)?.[1]?.toLowerCase();
    const src = li.match(/data-src="([^"]+\.(?:webp|png|jpg))"/)?.[1] ?? li.match(/src="([^"]*cards\/card\/(?!noimage)[^"]+)"/)?.[1];
    const alt = clean(li.match(/alt="([^"]*)"/)?.[1]);
    const name = alt.replace(new RegExp(`^${number}\\s*`), "").trim();
    if (!name) continue;
    out.push({ number, name, variant, parallel: variant?.startsWith("p") || undefined, image: src ? new URL(src, base).href : undefined });
  }
  return [...new Map(out.map((c) => [`${c.number}|${c.variant ?? ""}`, c])).values()];
}

/** catalogue anglais (cards.mjs) : numéro → nom et rareté */
async function englishCards() {
  const index = await readJson("cards/index.json", { games: {} });
  const votes = new Map();
  for (const set of index.games.dragonball?.sets ?? []) {
    const data = await readJson(set.file, null);
    for (const c of data?.cards ?? []) {
      const number = c.number?.split(/\s+/)[0]?.toUpperCase();
      if (!number || !c.name) continue;
      const name = c.name.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+\([^)]*\)\s*$/, "").trim();
      const v = votes.get(number) ?? { names: new Map(), rarity: c.rarity };
      v.names.set(name, (v.names.get(name) ?? 0) + 1);
      v.rarity ??= c.rarity;
      votes.set(number, v);
    }
  }
  return new Map([...votes].map(([n, v]) => [n, { en: [...v.names.entries()].sort((a, b) => b[1] - a[1])[0][0], rarity: v.rarity }]));
}

export async function fwLangs() {
  const en = await englishCards();
  for (const { lang, path } of REGIONS) {
    const DIR = `cards/dragonball-${lang}`;
    const base = `${SITE}/fw/${path}/cardlist/`;
    const prev = await readJson(`${DIR}/index.json`, { sets: [] });
    let list = [];
    try {
      list = products(await get(base));
    } catch (e) {
      console.warn(`Fusion World ${lang} : ${e.message}`);
      continue;
    }
    console.log(`Fusion World ${lang} : ${list.length} produits`);
    const sets = [];
    for (const [i, p] of list.entries()) {
      try {
        const cards = parseCards(await get(`${base}?search=true&category%5B0%5D=${p.id}`), base).map((c) => {
          const e = en.get(c.number.toUpperCase());
          return { ...c, en: e?.en, rarity: e?.rarity };
        });
        if (!cards.length) continue;
        const file = `${DIR}/${p.id}.json`;
        await writeJson(file, { id: p.id, name: p.name, code: p.code, cards });
        sets.push({ id: p.id, name: p.name, code: p.code, count: cards.length, file, version: hash(cards), order: list.length - i });
      } catch (e) {
        console.warn(`${lang} ${p.name} : ${e.message}`);
        const old = prev.sets.find((s) => s.id === p.id);
        if (old) sets.push(old);
      }
      await sleep(600);
    }
    if (!sets.length) continue;
    await writeJson(`${DIR}/index.json`, { updatedAt: new Date().toISOString().slice(0, 10), sets });
    const names = new Map();
    for (const [i, s] of sets.entries()) {
      const data = await readJson(s.file, null);
      for (const c of data?.cards ?? []) for (const n of [c.name, c.en].filter(Boolean)) names.set(n, new Set([...(names.get(n) ?? []), i]));
    }
    await writeJson(`${DIR}/names.json`, { groups: sets.map((s) => s.id), names: [...names.entries()].map(([n, l]) => [n, [...l]]) });
    console.log(`dragonball-${lang} : ${sets.length} produits, ${sets.reduce((n, s) => n + s.count, 0)} impressions`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await fwLangs();
