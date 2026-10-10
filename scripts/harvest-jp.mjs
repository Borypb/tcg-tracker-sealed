// Récolte du catalogue officiel japonais (pokemon-card.com) : noms officiels,
// dates de sortie, prix, visuels et contenu. Les accessoires (周辺グッズ) sont ignorés.
// Sortie : raw/pokemon-ja-official.json
import { createHash } from "node:crypto";
import { getJson, writeJson } from "./lib.mjs";

const SITE = "https://www.pokemon-card.com";
const TCGDEX = "https://api.tcgdex.net/v2";
const API = `${SITE}/products/resultAPI.php`;
const TYPES = ["expansion", "construction", "others"];

/** « 2026年 9月16日（水） » → 2026-09-16 */
export function parseJpDate(s) {
  const m = String(s ?? "").match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : undefined;
}

/** « 1,800円（税込） » → 1800 */
export function parseYen(s) {
  const m = String(s ?? "").replace(/,/g, "").match(/(\d+)\s*円/);
  return m ? Number(m[1]) : undefined;
}

/** type de produit d'après le nom japonais officiel */
export function classifyJa(title, productType) {
  const t = title.replace(/\s+/g, "");
  if (/プレミアムトレーナーボックス/.test(t)) return "premium_trainer_box";
  if (/デッキビルドBOX|デッキビルドボックス/i.test(t)) return "deck_build_box";
  if (/ハイクラスパック|拡張パック|強化拡張パック|コレクションパック|プロモカードパック/.test(t) && !/セット|BOX/.test(t)) return "booster";
  if (/スターターセット|スタートデッキ|スターターデッキ|構築デッキ|デッキ/.test(t) || productType === "構築デッキ") return "deck";
  if (/BOX|ボックス/i.test(t)) return "collection";
  return "collection";
}

const clean = (html) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** lignes « ・… » de la description = contenu du produit */
function contentsOf(description) {
  return clean(description)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[・･]/.test(l))
    .map((l) => l.replace(/^[・･]\s*/, ""))
    .slice(0, 12);
}

/** code d'extension tiré du lien de la page produit (/products/sv/sv6a.html, /ex/sv6/) */
function setCodeOf(link) {
  const m = String(link ?? "").match(/\/(?:products\/[a-z]+|ex)\/([a-z]+\d+[a-z]?)(?:[./]|$)/i);
  return m ? m[1] : undefined;
}

function safeUrl(link) {
  try {
    return link ? new URL(link, SITE).href : undefined;
  } catch {
    return undefined;
  }
}

export async function harvestJpOfficial() {
  // codes d'extension TCGdex japonais (« SV2a ») pour rattacher les produits
  let tcgdexIds = new Map();
  try {
    tcgdexIds = new Map((await getJson(`${TCGDEX}/ja/sets`, { delay: 0 })).map((s) => [s.id.toLowerCase(), s.id]));
  } catch (e) {
    console.warn("TCGdex ja indisponible : produits non rattachés aux extensions", e.message);
  }
  const products = [];
  for (const type of TYPES) {
    let page = 1;
    let maxPage = 1;
    do {
      const json = await getJson(`${API}?productType=${type}&page=${page}`, { delay: 800 });
      maxPage = json.maxPage ?? 1;
      for (const p of json.products ?? []) {
        const title = clean(p.productTitle).replace(/^「(.*)」$/, "$1").replace(/\s+/g, " ").trim();
        if (!title) continue;
        const releasedAt = parseJpDate(p.releaseDate);
        products.push({
          // identifiant stable : titre + date (le site n'en expose pas)
          key: createHash("sha1").update(`${title}|${releasedAt ?? ""}`).digest("hex").slice(0, 10),
          title,
          type,
          productType: p.productType,
          kind: classifyJa(title, p.productType),
          releasedAt,
          yen: parseYen(p.priceTxt),
          image: p.tumbsImg ? `${SITE}${p.tumbsImg}` : undefined,
          contents: contentsOf(p.description),
          setCode: tcgdexIds.get(setCodeOf(p.link_detailPage)?.toLowerCase() ?? ""),
          page: safeUrl(p.link_detailPage)
        });
      }
      page++;
    } while (page <= maxPage && page < 200);
  }
  // un même produit peut apparaître dans deux rubriques
  const unique = [...new Map(products.map((p) => [p.key, p])).values()];
  await writeJson("raw/pokemon-ja-official.json", { harvestedAt: new Date().toISOString(), products: unique });
  console.log(`pokemon/ja officiel : ${unique.length} produits`);
  return unique;
}

if (import.meta.url === `file://${process.argv[1]}`) await harvestJpOfficial();
