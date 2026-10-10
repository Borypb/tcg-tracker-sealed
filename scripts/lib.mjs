// Outils communs aux scripts du catalogue (Node 20+, sans dépendance).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const UA = "tcg-tracker-sealed/1.0 (+https://github.com/Borypb/tcg-tracker-sealed)";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { retries = 3, delay = 250 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const json = await res.json();
      await sleep(delay);
      return json;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
}

export async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

export function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Type de produit d'après son nom anglais (catalogue TCGplayer).
 * L'ordre compte : du plus précis au plus générique.
 */
export function classify(name) {
  const n = name.toLowerCase();
  if (/\bcase\b/.test(n) && /(booster box|elite trainer box|display|bundle|tin)/.test(n)) return "case";
  if (/code card/.test(n)) return null;
  if (/elite trainer box/.test(n)) return "etb";
  if (/ultra[- ]premium collection/.test(n)) return "upc";
  if (/super[- ]premium collection/.test(n)) return "spc";
  if (/booster display|booster box/.test(n)) return "booster_box";
  if (/booster bundle/.test(n)) return "bundle";
  if (/build (&|and) battle/.test(n)) return "build_battle";
  if (/mini tin/.test(n)) return "mini_tin";
  if (/\btin\b/.test(n)) return "tin";
  if (/blister|\b(2|3)[- ]pack\b|checklane/.test(n)) return "blister";
  if (/theme deck|battle deck|starter deck|trainer kit|league battle|deck box/.test(n) && !/collection/.test(n)) return "deck";
  if (/binder|portfolio|pocket/.test(n)) return "binder";
  if (/booster pack|sleeved booster|^.*\bbooster$/.test(n)) return "booster";
  if (/collection|box\b|chest|bundle|calendar/.test(n)) return "collection";
  return "other";
}

/** produits réservés aux enseignes américaines : pas d'équivalent européen probable */
export const US_ONLY = /\b(target|walmart|costco|sam'?s club|best buy|gamestop|meijer|kmart|toys ?r ?us|dollar general|staples|bj'?s|pokemon center|pokémon center|exclusive)\b/i;
