// Script 3 — assemble les fichiers publiés lus par l'app.
// Priorité : catalogue manuel (curated/) > déduit (generated/) > récolte brute (raw/).
// La version d'un fichier n'est incrémentée que si son contenu change.
import { classify, readJson, writeJson } from "./lib.mjs";

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
    for (const p0 of g.products) {
      const p = { ...p0, kind: classify(p0.name) };
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

/**
 * Japonais : le catalogue officiel (noms japonais, prix, contenu) est la source principale.
 * TCGplayer n'apporte que les BOX (boîtes de boosters), absentes du site officiel ;
 * elles prennent le nom japonais du pack quand l'extension est connue.
 */
function japanese(official, rawJa, prefix) {
  const out = [];
  const packBySet = new Map();
  for (const p of official?.products ?? []) {
    if (p.kind === "booster" && p.setCode && !packBySet.has(p.setCode.toLowerCase())) packBySet.set(p.setCode.toLowerCase(), p);
    out.push({
      id: `${prefix}-ja-pcg-${p.key}`,
      kind: p.kind,
      name: p.title,
      lang: "ja",
      setIds: p.setCode ? [`${prefix}-${p.setCode}`] : undefined,
      releasedAt: p.releasedAt,
      extras: p.contents?.length ? p.contents : undefined,
      image: p.image,
      msrp: p.yen ? { jpy: p.yen } : undefined,
      source: { official: p.page ?? "https://www.pokemon-card.com/products/" },
      verified: true
    });
  }
  for (const p of fromRaw(rawJa, prefix)) {
    if (p.kind !== "booster_box") continue;
    const setCode = p.setIds?.[0]?.slice(prefix.length + 1);
    const pack = setCode ? packBySet.get(setCode.toLowerCase()) : undefined;
    out.push({
      ...p,
      name: pack ? `${pack.title} BOX` : p.name,
      aliases: pack ? [p.name] : undefined,
      contents: undefined
    });
  }
  return out;
}

export async function build() {
  const index = await readJson("index.json", { version: 1, games: {} });
  let changed = false;
  for (const [game, cfg] of Object.entries(GAMES)) {
    const entry = { files: {} };
    for (const lang of cfg.langs) {
      const curated = await readJson(`curated/${game}-${lang}.json`, null);
      const generated = await readJson(`generated/${game}-${lang}.json`, []);
      const rawData = await readJson(`raw/${game}-${lang}.json`, null);
      const official = lang === "ja" ? await readJson(`raw/${game}-ja-official.json`, null) : null;
      const raw = official ? japanese(official, rawData, cfg.prefix) : fromRaw(rawData, cfg.prefix);
      const merged = new Map();
      for (const p of [...raw, ...generated]) merged.set(p.id, p);
      for (const p of curated?.products ?? []) {
        // un produit déduit du même type et de la même extension est le même produit
        const twins = [...merged.values()].filter(
          (x) => x.id !== p.id && x.derived && x.kind === p.kind && p.setIds?.[0] && x.setIds?.[0] === p.setIds[0]
        );
        if (twins.length === 1) merged.delete(twins[0].id);
        merged.set(p.id, { ...merged.get(p.id), ...p, verified: true });
      }
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
