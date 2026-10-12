// Script 5 — cartes des licences sans API publique (Dragon Ball Super Fusion World, Palworld, Digimon),
// depuis le catalogue TCGplayer (TCGCSV). Images du CDN TCGplayer, cote du marché américain en $.
// Incrémental : une extension n'est retéléchargée que si son `modifiedOn` a changé ; ses cotes, chaque jour.
// Sortie : cards/index.json + cards/<licence>/<groupId>.json
import { createHash } from "node:crypto";
import { getJson, readJson, writeJson } from "./lib.mjs";

const TCGCSV = "https://tcgcsv.com/tcgplayer";

/** licences de l'app → catégorie TCGplayer (nom exact, en minuscules, essayé dans l'ordre) */
export const CARD_GAMES = {
  dragonball: [/^dragon ball super fusion world$/i, /fusion world/i],
  palworld: [/^palworld/i],
  digimon: [/^digimon card game$/i, /^digimon/i]
};

/** champs « extendedData » utiles, quel que soit leur nom exact selon la catégorie */
const field = (p, ...names) => {
  const e = (p.extendedData ?? []).find((x) => names.some((n) => x.name.toLowerCase() === n.toLowerCase()));
  return e?.value ? String(e.value).replace(/<[^>]+>/g, "").trim() : undefined;
};

const isCard = (p) => Boolean(field(p, "Number", "Rarity"));

/** TCGplayer met la date de récolte à la place des dates inconnues */
const realDate = (d) => (d && !/\.\d{5,}Z$/.test(d) ? d.slice(0, 10) : undefined);

/** « Son Goku - FB01-001 (Parallel) » → nom « Son Goku », précision « Parallel » */
function splitName(raw, number) {
  let name = raw;
  const extras = [];
  name = name.replace(/\s*\(([^)]+)\)/g, (_, x) => (extras.push(x.trim()), ""));
  if (number) name = name.replace(new RegExp(`\\s*[-–]\\s*${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  return { name: name.trim(), label: extras.join(" · ") || undefined };
}

async function category(patterns, cats) {
  for (const re of patterns) {
    const hit = cats.find((c) => re.test(c.name) || re.test(c.displayName ?? ""));
    if (hit) return hit;
  }
  return null;
}

const hash = (x) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 12);

export async function cards() {
  const index = await readJson("cards/index.json", { version: 1, games: {} });
  const cats = (await getJson(`${TCGCSV}/categories`)).results ?? [];
  for (const [game, patterns] of Object.entries(CARD_GAMES)) {
    const cat = await category(patterns, cats);
    if (!cat) {
      console.warn(`${game} : catégorie TCGplayer introuvable`);
      continue;
    }
    const prev = index.games[game] ?? { sets: [] };
    const prevById = new Map(prev.sets.map((s) => [s.groupId, s]));
    const groups = ((await getJson(`${TCGCSV}/${cat.categoryId}/groups`)).results ?? []).filter((g) => !/^(sealed|accessor)/i.test(g.name));
    const sets = [];
    let fetched = 0;
    for (const g of groups) {
      const file = `cards/${game}/${g.groupId}.json`;
      const old = prevById.get(g.groupId);
      let data = old && old.modifiedOn === g.modifiedOn ? await readJson(file, null) : null;
      if (!data) {
        const products = ((await getJson(`${TCGCSV}/${cat.categoryId}/${g.groupId}/products`, { delay: 150 })).results ?? []).filter(isCard);
        fetched++;
        data = {
          groupId: g.groupId,
          cards: products.map((p) => {
            const number = field(p, "Number");
            const { name, label } = splitName(p.name, number);
            return {
              id: p.productId,
              name,
              label,
              number,
              rarity: field(p, "Rarity"),
              type: field(p, "CardType", "Card Type", "Type"),
              image: p.imageUrl,
              url: p.url
            };
          })
        };
      }
      if (!data.cards.length) continue;
      // cotes du jour : une ligne par finition (Normal, Foil…)
      try {
        const prices = (await getJson(`${TCGCSV}/${cat.categoryId}/${g.groupId}/prices`, { delay: 150 })).results ?? [];
        const by = new Map();
        for (const r of prices) {
          const v = r.marketPrice ?? r.midPrice ?? r.lowPrice;
          by.set(r.productId, [...(by.get(r.productId) ?? []), { sub: r.subTypeName, usd: v ?? null }]);
        }
        for (const c of data.cards) c.prices = by.get(c.id) ?? [];
        data.pricesAt = new Date().toISOString().slice(0, 10);
      } catch (e) {
        console.warn(`${game}/${g.name} : cotes indisponibles`, e.message);
      }
      await writeJson(file, data);
      sets.push({
        groupId: g.groupId,
        name: g.name,
        code: g.abbreviation || undefined,
        releasedAt: realDate(g.publishedOn),
        modifiedOn: g.modifiedOn,
        count: data.cards.length,
        file,
        // la version change si les cartes changent (pas pour les seules cotes)
        version: hash(data.cards.map(({ prices, ...c }) => c))
      });
    }
    index.games[game] = { categoryId: cat.categoryId, category: cat.name, sets };
    console.log(`${game} (${cat.name}) : ${sets.length} extensions, ${sets.reduce((n, s) => n + s.count, 0)} cartes, ${fetched} extensions mises à jour`);
  }
  index.updatedAt = new Date().toISOString().slice(0, 10);
  await writeJson("cards/index.json", index);
}

if (import.meta.url === `file://${process.argv[1]}`) await cards();
