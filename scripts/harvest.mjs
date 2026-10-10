// Script 1 — récolte des produits scellés depuis TCGCSV (catalogue TCGplayer).
// Incrémental : un groupe (extension) n'est retéléchargé que si son `modifiedOn` a changé.
// Sortie : raw/<licence>-<langue>.json
import { classify, getJson, norm, readJson, writeJson } from "./lib.mjs";

const TCGCSV = "https://tcgcsv.com/tcgplayer";
const TCGDEX = "https://api.tcgdex.net/v2";

/** licences et catégories TCGplayer à récolter */
export const SOURCES = {
  pokemon: [
    { lang: "en", categoryId: 3, tcgdexLang: "en" },
    { lang: "ja", categoryName: /^pokemon japan$/i, tcgdexLang: "ja" }
  ]
};

const isSealed = (p) =>
  !(p.extendedData ?? []).some((e) => /^(number|rarity)$/i.test(e.name)) && classify(p.name) !== null;

/** TCGplayer met la date de récolte à la place des dates inconnues */
const realDate = (d) => (d && !/\.\d{5,}Z$/.test(d) ? d.slice(0, 10) : undefined);

/** noms TCGplayer qui ne se déduisent pas du nom TCGdex */
const GROUP_ALIASES = {
  "sm base set": "sun and moon",
  expedition: "expedition base set",
  "base set shadowless": "base set",
  "sv scarlet and violet promo cards": "svp black star promos",
  "swsh sword and shield promo cards": "swsh black star promos",
  "sm promos": "sm black star promos",
  "xy promos": "xy black star promos",
  "black and white promos": "bw black star promos",
  "me mega evolution promo": "mep black star promos"
};

function stripGroupPrefix(name) {
  const stripped = name
    .replace(/^(sv|swsh|sm|xy|me|bw|dp|hgss|ex)\d*[a-z]?\s*[:\-–]\s*/i, "")
    .replace(/^(sv|swsh|sm|xy|me|mee|sve)\s*[:\-–]\s*/i, "")
    .trim();
  const withoutBase = stripped.replace(/\bbase set\b/i, "").trim();
  return withoutBase || stripped;
}

async function tcgdexSets(lang) {
  try {
    return await getJson(`${TCGDEX}/${lang}/sets`, { delay: 0 });
  } catch (e) {
    console.warn(`TCGdex ${lang} indisponible : rattachement aux extensions ignoré`, e.message);
    return [];
  }
}

/** rattache un groupe TCGplayer à une extension TCGdex (même identifiant que l'app) */
export function matchSet(group, sets, lang) {
  if (lang === "ja") {
    // groupes japonais : « SV2a: Pokemon Card 151 » → code TCGdex « SV2a »
    const code = group.name.split(":")[0].trim();
    return sets.find((s) => s.id.toLowerCase() === code.toLowerCase())?.id;
  }
  const alias = GROUP_ALIASES[norm(group.name)];
  const target = alias ?? norm(stripGroupPrefix(group.name));
  const exact = sets.filter((s) => norm(s.name) === target);
  if (exact.length === 1) return exact[0].id;
  const ends = sets.filter((s) => norm(s.name).length >= 3 && target.endsWith(norm(s.name)));
  return ends.length === 1 ? ends[0].id : undefined;
}

async function resolveCategory(src) {
  if (src.categoryId) return src.categoryId;
  const cats = await getJson(`${TCGCSV}/categories`);
  const hit = (cats.results ?? []).find((c) => src.categoryName.test(c.name));
  if (!hit) throw new Error(`Catégorie introuvable : ${src.categoryName}`);
  return hit.categoryId;
}

export async function harvest(game, src) {
  const out = `raw/${game}-${src.lang}.json`;
  const previous = await readJson(out, { groups: {} });
  const categoryId = await resolveCategory(src);
  const sets = await tcgdexSets(src.tcgdexLang);
  const groups = (await getJson(`${TCGCSV}/${categoryId}/groups`)).results ?? [];
  const result = { game, lang: src.lang, categoryId, harvestedAt: new Date().toISOString(), groups: {} };
  let fetched = 0;

  for (const g of groups) {
    const cached = previous.groups?.[g.groupId];
    const setCode = matchSet(g, sets, src.tcgdexLang);
    if (cached && cached.modifiedOn === g.modifiedOn) {
      result.groups[g.groupId] = { ...cached, setCode: setCode ?? cached.setCode };
      continue;
    }
    const products = (await getJson(`${TCGCSV}/${categoryId}/${g.groupId}/products`)).results ?? [];
    fetched++;
    result.groups[g.groupId] = {
      name: g.name,
      abbreviation: g.abbreviation || undefined,
      modifiedOn: g.modifiedOn,
      publishedOn: realDate(g.publishedOn),
      setCode,
      products: products.filter(isSealed).map((p) => ({
        tcgplayerId: p.productId,
        name: p.name,
        kind: classify(p.name),
        releasedOn: realDate(p.presaleInfo?.releasedOn) ?? realDate(g.publishedOn),
        image: p.imageUrl,
        url: p.url
      }))
    };
  }
  await writeJson(out, result);
  const count = Object.values(result.groups).reduce((n, g) => n + g.products.length, 0);
  const unmatched = Object.values(result.groups).filter((g) => g.products.length && !g.setCode).length;
  console.log(`${game}/${src.lang} : ${count} produits scellés, ${fetched} groupes mis à jour, ${unmatched} groupes sans extension TCGdex`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [game, sources] of Object.entries(SOURCES)) {
    for (const src of sources) await harvest(game, src);
  }
}
