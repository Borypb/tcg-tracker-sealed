// Cotes du marché secondaire (≠ prix de sortie) pour les produits scellés.
//  - Cardmarket : fichiers publics du jour (liste des produits scellés + guide des prix), en €.
//    Une fiche Cardmarket couvre toutes les langues européennes : la cote est « toutes langues ».
//  - TCGplayer (via TCGCSV) : prix du marché américain, en $.
// Sortie : prices-pokemon.json (fichier séparé : il change tous les jours, pas le catalogue).
import { readFile, writeFile } from "node:fs/promises";
import { getJson, readJson, writeJson } from "./lib.mjs";

const CM = "https://downloads.s3.cardmarket.com/productCatalog";
const CM_GAME = { pokemon: 6 };
const TCGCSV = "https://tcgcsv.com/tcgplayer";

const STOP = new Set(["pokemon", "tcg", "the", "and", "of", "a", "with", "pack", "version", "international", "eu", "retail", "edition", "set"]);
const PLURAL = { tins: "tin", blisters: "blister", boxes: "box", collections: "collection", decks: "deck", boosters: "booster", packs: "pack", kits: "kit" };

export function tokens(s) {
  return new Set(
    String(s ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/(\d)\s*-\s*pack/g, "$1pack")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => PLURAL[w] ?? w)
      .filter((w) => !STOP.has(w))
  );
}

/** catégories Cardmarket compatibles avec chaque type */
const CM_KINDS = {
  etb: ["Pokémon Elite Trainer Boxes"],
  booster_box: ["Pokémon Display"],
  bundle: ["Pokémon Display", "Pokémon Box Set"],
  booster: ["Pokémon Booster"],
  tin: ["Pokémon Tins"],
  mini_tin: ["Pokémon Tins"],
  blister: ["Pokémon Blisters"],
  deck: ["Pokémon Theme Decks", "Pokémon Trainer Kits"],
  collection: ["Pokémon Box Set"],
  upc: ["Pokémon Box Set"],
  spc: ["Pokémon Box Set"],
  build_battle: ["Pokémon Box Set"],
  binder: ["Pokémon Box Set"],
  premium_trainer_box: ["Pokémon Box Set", "Pokémon Elite Trainer Boxes"],
  deck_build_box: ["Pokémon Box Set"]
};
/** fiches à ne jamais retenir : variantes régionales, cartons, pièces, lots */
const CM_EXCLUDE = /\b(chinese|korean|indonesian|thai|pok[eé]mon center|case|coin|lot)\b|\(us version\)|\bdisplay\b(?!.*booster)/i;

function jaccard(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export function buildMatcher(cmProducts) {
  const byToken = new Map();
  const items = cmProducts
    .filter((p) => !CM_EXCLUDE.test(p.name) || /booster box|booster bundle/i.test(p.name))
    .map((p) => ({ ...p, tok: tokens(p.name) }));
  for (const it of items) for (const w of it.tok) (byToken.get(w) ?? byToken.set(w, []).get(w)).push(it);
  /** meilleure fiche Cardmarket pour un nom donné (null si incertain) */
  return function match(name, kind, setName) {
    const cats = CM_KINDS[kind];
    if (!cats) return null;
    const variants = [tokens(name)];
    // éditions visuelles entre crochets (« [Koraidon] ») : Cardmarket a souvent une seule fiche.
    // Pas pour 1st Edition / Unlimited, dont les cotes n'ont rien à voir.
    if (/\[[^\]]+\]/.test(name) && !/1st edition|unlimited|shadowless|revised/i.test(name)) {
      variants.push(tokens(name.replace(/\[[^\]]*\]/g, " ")));
    }
    if (setName) {
      for (const v of [...variants]) {
        const withSet = new Set([...tokens(setName), ...v]);
        if (withSet.size > v.size) variants.push(withSet);
      }
    }
    let best = null;
    let second = 0;
    for (const tok of variants) {
      const rare = [...tok].sort((x, y) => (byToken.get(x)?.length ?? 1e9) - (byToken.get(y)?.length ?? 1e9))[0];
      for (const it of byToken.get(rare) ?? []) {
        if (!cats.includes(it.categoryName)) continue;
        // un display ne peut pas être un « booster box (18 boosters) » si on cherche le display complet, etc.
        const score = jaccard(tok, it.tok) + (/\(eu version\)/i.test(it.name) ? 0.01 : 0);
        if (!best || score > best.score) {
          if (best && best.it.idProduct !== it.idProduct) second = Math.max(second, best.score);
          best = { it, score };
        } else if (it.idProduct !== best.it.idProduct) second = Math.max(second, score);
      }
    }
    if (!best || best.score < 0.75 || best.score - second < 0.08) return null;
    return best.it.idProduct;
  };
}

async function loadCardmarket(game) {
  const id = CM_GAME[game];
  if (process.env.CM_DIR) {
    const read = async (f) => JSON.parse(await readFile(`${process.env.CM_DIR}/${f}`, "utf8"));
    return { products: (await read("nonsingles.json")).products, guide: await read("pg-nonsingles.json") };
  }
  const products = (await getJson(`${CM}/productList/products_nonsingles_${id}.json`, { delay: 0 })).products;
  const guide = await getJson(`${CM}/priceGuide/price_guide_${id}.json`, { delay: 0 });
  return { products, guide };
}

const round = (n) => (typeof n === "number" && n > 0 ? Math.round(n * 100) / 100 : undefined);

export async function prices(game = "pokemon", prefix = "pkm") {
  const out = {};
  const rawEn = await readJson(`raw/${game}-en.json`, null);
  const rawJa = await readJson(`raw/${game}-ja.json`, null);

  // 1. rapprochement produit TCGplayer → fiche Cardmarket
  let cm = null;
  let cmAt;
  const tcpToCm = new Map();
  try {
    cm = await loadCardmarket(game);
    cmAt = cm.guide.createdAt;
    const match = buildMatcher(cm.products);
    for (const raw of [rawEn, rawJa]) {
      for (const g of Object.values(raw?.groups ?? {})) {
        const setName = g.setCode ? g.name.replace(/^[A-Za-z]{1,5}\d*[a-z]?(?:\.\d)?:\s*/, "") : undefined;
        for (const p of g.products) {
          const id = match(p.name, p.kind, setName);
          if (id) tcpToCm.set(p.tcgplayerId, id);
        }
      }
    }
  } catch (e) {
    console.warn("Cardmarket indisponible :", e.message);
  }
  const guide = new Map((cm?.guide.priceGuides ?? []).map((x) => [x.idProduct, x]));
  const cmName = new Map((cm?.products ?? []).map((x) => [x.idProduct, x.name]));

  // 2. prix du marché américain, groupe par groupe
  const tcp = new Map();
  if (!process.env.SKIP_TCGPLAYER) {
    for (const raw of [rawEn, rawJa]) {
      for (const [groupId, g] of Object.entries(raw?.groups ?? {})) {
        if (!g.products.length) continue;
        try {
          const json = await getJson(`${TCGCSV}/${raw.categoryId}/${groupId}/prices`, { delay: 150 });
          for (const r of json.results ?? []) {
            if (!tcp.has(r.productId)) tcp.set(r.productId, { market: round(r.marketPrice), low: round(r.lowPrice) });
          }
        } catch {
          /* groupe ignoré */
        }
      }
    }
  }

  // 3. cotes par produit du catalogue publié
  const cote = (tcgplayerId) => {
    if (!tcgplayerId) return undefined;
    const c = guide.get(tcpToCm.get(tcgplayerId));
    const t = tcp.get(tcgplayerId);
    const res = {};
    if (c && (c.trend || c.avg || c.low)) res.cm = {
        id: c.idProduct,
        name: cmName.get(c.idProduct),
        trend: round(c.trend),
        avg: round(c.avg),
        low: round(c.low),
        avg1: round(c.avg1),
        avg7: round(c.avg7),
        avg30: round(c.avg30)
      };
    if (t && (t.market || t.low)) res.tp = t;
    return Object.keys(res).length ? res : undefined;
  };
  const files = { fr: null, en: null, ja: null };
  for (const lang of Object.keys(files)) files[lang] = (await readJson(`${game}-${lang}.json`, { products: [] })).products;
  // EN : rattachement par extension + type pour les produits vérifiés à la main
  // (on écarte demi-displays, exclusivités et cartons pour ne garder que le produit standard)
  const enBySetKind = new Map();
  for (const p of files.en) {
    const id = Number(p.id.match(/tcp(\d+)$/)?.[1]);
    if (!id || !p.setIds?.[0] || /half|pok[eé]mon center|exclusive|case|1st edition/i.test(p.name)) continue;
    const key = `${p.setIds[0]}|${p.kind}`;
    enBySetKind.set(key, [...(enBySetKind.get(key) ?? []), id]);
  }
  for (const [lang, products] of Object.entries(files)) {
    for (const p of products) {
      const id =
        p.source?.tcgplayer ??
        Number(p.id.match(/tcp(\d+)$/)?.[1]) ??
        undefined;
      const fromDerived = Number(String(p.derived?.from ?? "").replace("tcgplayer:", "")) || undefined;
      const fromSet = p.setIds?.[0] ? (enBySetKind.get(`${p.setIds[0]}|${p.kind}`) ?? []).find((x) => tcpToCm.has(x)) : undefined;
      const c = cote((Number.isFinite(id) && id) || fromDerived || (lang !== "ja" ? fromSet : undefined));
      if (c) out[p.id] = c;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  // compact : le fichier est téléchargé chaque jour par les apps
  await writeFile(`prices-${game}.json`, JSON.stringify({ date: today, cardmarketAt: cmAt, items: out }));
  const index = await readJson("index.json", {});
  index.prices = { ...(index.prices ?? {}), [game]: { file: `prices-${game}.json`, date: today, count: Object.keys(out).length } };
  await writeJson("index.json", index);
  const withCm = Object.values(out).filter((x) => x.cm).length;
  console.log(`cotes ${game} : ${Object.keys(out).length} produits (${withCm} Cardmarket, ${tcpToCm.size} rapprochements)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await prices();
