// Script 8 — cartes Digimon japonaises du site officiel (digimoncard.com), absentes du catalogue TCGplayer
// (américain, anglais seulement). Une page par produit (« 収録弾 ») liste toutes ses cartes : numéro, rareté,
// type, niveau, nom, illustration (les parallèles ont leur propre image, « BT1-001_P1.png »).
// Sortie : cards/digimon-ja/index.json, cards/digimon-ja/<produit>.json, cards/digimon-ja/names.json
import { createHash } from "node:crypto";
import { readJson, sleep, writeJson } from "./lib.mjs";

const SITE = "https://digimoncard.com";
const UA = "Mozilla/5.0 (compatible; Thothectio-catalog/1.0; +https://github.com/Borypb/thothectio-sealed)";
const DIR = "cards/digimon-ja";

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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** produits du menu « 収録弾 » : identifiant, nom, code (« BT-25 ») */
async function products() {
  const html = await get(`${SITE}/cardlist/`);
  const select = html.match(/<select name="category"[\s\S]*?<\/select>/)?.[0] ?? "";
  return [...select.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map(([, id, label]) => {
    const name = clean(label);
    return { id, name, code: name.match(/【([^】]+)】/)?.[1] };
  });
}

/** cartes d'un produit : un bloc « image_lists_item » par impression (base et parallèles) */
function parseCards(html) {
  const out = [];
  for (const block of html.split('<li class="image_lists_item').slice(1)) {
    const number = clean(block.match(/<li class="cardNo">([\s\S]*?)<\/li>/)?.[1]);
    const name = clean(block.match(/<div class="cardTitle">([\s\S]*?)<\/div>/)?.[1]);
    if (!number || !name) continue;
    const src = block.match(/<a class="card_img"[\s\S]*?<img[^>]*?(?:data-src|src)="([^"]*cardlist\/card\/(?!noimage)[^"]+)"/)?.[1]
      ?? block.match(/(?:data-src|src)="([^"]*cardlist\/card\/(?!noimage)[^"]+)"/)?.[1];
    const file = src?.match(/card\/([^/?"]+)\.(?:png|jpg)/i)?.[1] ?? number;
    const variant = file.includes("_") ? file.split("_").slice(1).join("_").toLowerCase() : undefined;
    out.push({
      number,
      name,
      rarity: clean(block.match(/<li class="cardRarity">([\s\S]*?)<\/li>/)?.[1]) || undefined,
      type: clean(block.match(/<li class="cardType">([\s\S]*?)<\/li>/)?.[1]) || undefined,
      level: clean(block.match(/<li class="cardLv">([\s\S]*?)<\/li>/)?.[1]) || undefined,
      parallel: /class="parallel_icon"/.test(block) || undefined,
      variant,
      image: src ? new URL(src, `${SITE}/cards/`).href : undefined
    });
  }
  // une même impression peut figurer deux fois (fenêtre de détail) : on garde la première
  return [...new Map(out.map((c) => [`${c.number}|${c.variant ?? ""}`, c])).values()];
}

export async function digimonJa() {
  const list = await products();
  console.log(`digimoncard.com : ${list.length} produits`);
  const prev = await readJson(`${DIR}/index.json`, { sets: [] });
  const sets = [];
  for (const [i, p] of list.entries()) {
    try {
      const cards = parseCards(await get(`${SITE}/cards/?search=true&category=${p.id}`));
      if (!cards.length) continue;
      const file = `${DIR}/${p.id}.json`;
      await writeJson(file, { id: p.id, name: p.name, code: p.code, cards });
      sets.push({ id: p.id, name: p.name, code: p.code, count: cards.length, file, version: hash(cards), order: list.length - i });
    } catch (e) {
      console.warn(`${p.name} : ${e.message}`);
      const old = prev.sets.find((s) => s.id === p.id);
      if (old) sets.push(old);
    }
    await sleep(600);
  }
  await writeJson(`${DIR}/index.json`, { updatedAt: new Date().toISOString().slice(0, 10), sets });
  // index des noms (recherche de l'app) : nom → produits où il figure
  const names = new Map();
  for (const [i, s] of sets.entries()) {
    const data = await readJson(s.file, null);
    for (const c of data?.cards ?? []) names.set(c.name, new Set([...(names.get(c.name) ?? []), i]));
  }
  await writeJson(`${DIR}/names.json`, { groups: sets.map((s) => s.id), names: [...names.entries()].map(([n, l]) => [n, [...l]]) });
  console.log(`digimon-ja : ${sets.length} produits, ${sets.reduce((n, s) => n + s.count, 0)} impressions (précédemment ${prev.sets.length} produits)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await digimonJa();
