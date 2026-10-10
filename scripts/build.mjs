// Script 3 — assemble les fichiers publiés lus par l'app.
// Priorité : catalogue manuel (curated/) > déduit (generated/) > récolte brute (raw/).
// La version d'un fichier n'est incrémentée que si son contenu change.
import { readJson, writeJson } from "./lib.mjs";

const GAMES = { pokemon: { prefix: "pkm", langs: ["fr", "en", "ja"] } };
const SKIP_KINDS = new Set(["case"]);

function boosterCount(kind, setCode) {
  const era = (setCode ?? "").replace(/[\d.].*$/, "").toLowerCase();
  if (kind === "etb") return ["sv", "me"].includes(era) ? 9 : ["swsh", "sm", "xy"].includes(era) ? 8 : undefined;
  if (kind === "booster_box") return 36;
  if (kind === "bundle") return 6;
  if (kind === "build_battle") return 4;
  return undefined;
}

/** produits de la récolte brute, dans leur langue d'origine */
function fromRaw(raw, prefix) {
  if (!raw) return [];
  const out = [];
  for (const g of Object.values(raw.groups)) {
    for (const p of g.products) {
      if (!p.kind || SKIP_KINDS.has(p.kind)) continue;
      const setId = g.setCode ? `${prefix}-${g.setCode}` : undefined;
      const qty = boosterCount(p.kind, g.setCode);
      out.push({
        id: `${prefix}-${raw.lang}-tcp${p.tcgplayerId}`,
        kind: p.kind,
        name: p.name,
        lang: raw.lang,
        setIds: setId ? [setId] : undefined,
        releasedAt: p.releasedOn,
        contents: qty && setId ? [{ type: "booster", setId, qty }] : undefined,
        image: p.image,
        source: { tcgplayer: p.tcgplayerId }
      });
    }
  }
  return out;
}

const clean = (o) => JSON.parse(JSON.stringify(o)); // retire les undefined

export async function build() {
  const index = await readJson("index.json", { version: 1, games: {} });
  let changed = false;
  for (const [game, cfg] of Object.entries(GAMES)) {
    const entry = { files: {} };
    for (const lang of cfg.langs) {
      const curated = await readJson(`curated/${game}-${lang}.json`, null);
      const generated = await readJson(`generated/${game}-${lang}.json`, []);
      const raw = fromRaw(await readJson(`raw/${game}-${lang}.json`, null), cfg.prefix);
      const merged = new Map();
      for (const p of [...raw, ...generated]) merged.set(p.id, p);
      for (const p of curated?.products ?? []) merged.set(p.id, { ...merged.get(p.id), ...p, verified: true });
      const products = clean(
        [...merged.values()].sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") || a.id.localeCompare(b.id))
      );
      if (!products.length) continue;

      const file = `${game}-${lang}.json`;
      const previous = await readJson(file, null);
      const prevEntry = index.games?.[game]?.files?.[lang];
      const same = previous && JSON.stringify(previous.products) === JSON.stringify(products);
      const version = same ? previous.version : (prevEntry?.version ?? previous?.version ?? 0) + 1;
      if (!same) {
        await writeJson(file, { version, game, lang, products });
        changed = true;
        console.log(`${file} : v${version}, ${products.length} produits`);
      }
      entry.files[lang] = { file, version, count: products.length };
    }
    if (JSON.stringify(index.games?.[game]) !== JSON.stringify(entry)) changed = true;
    index.games = { ...index.games, [game]: entry };
  }
  if (changed) {
    index.version = (index.version ?? 0) + 1;
    index.updatedAt = new Date().toISOString().slice(0, 10);
    await writeJson("index.json", index);
    console.log(`index.json : v${index.version}`);
  } else {
    console.log("Aucun changement : versions inchangées");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
