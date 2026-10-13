// Index du scan à l'image : empreinte visuelle de chaque image de carte, par licence et par langue.
// TCG Tracker s'en sert pour reconnaître une carte à l'image sans rien télécharger d'avance :
// l'index est lu en mémoire, la carte reconnue est ensuite demandée à sa source (TCGdex, Scryfall…).
//
// On ne publie ni les images ni les fiches : seulement l'adresse de l'image, une clé pour retrouver
// la carte à sa source, et l'empreinte (512 bits, impossible de reconstituer l'image à partir d'elle).
//
// Incrémental : les empreintes déjà calculées (index précédent, dossier SCAN_OUT) sont reprises ;
// seules les images nouvelles sont téléchargées, dans la limite de SCAN_BUDGET_MIN minutes.
// Les cartes pas encore traitées le seront à la passe suivante (les plus récentes d'abord).
//
// Sortie (branche « scan », publiée sans historique) :
//   index.json                    fichiers disponibles, nombre de cartes traitées / connues
//   <licence>-<langue>.json       { fp, game, lang, keys: [...], imgs: [...] }
//   <licence>-<langue>.bin        n × 64 octets : carte entière (8 × uint32 LE) puis illustration (8 × uint32 LE)
//   state/                        listes complètes et échecs, pour la passe suivante
//
// Clé (keys[i]) selon la licence, ce que l'app utilise pour retrouver la carte :
//   pokemon   identifiant TCGdex de la carte (« sv03-001 »)
//   magic     « <code d'extension>/<numéro> » (Scryfall)
//   yugioh    identifiant YGOPRODeck de la carte
//   lorcana   code d'extension Lorcast           ┐ l'app télécharge l'extension (en mémoire)
//   onepiece  identifiant du produit punk-records ├ et y cherche la carte par l'adresse
//   riftbound identifiant d'extension Riftcodex   │ de son image
//   dragonball, palworld, digimon : fichier de l'extension dans ce dépôt (cards/…) ┘
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UA, getJson, readJson } from "./lib.mjs";
import { FP_VERSION, fingerprintPixels } from "./scan/fingerprint.mjs";
import { selfTest } from "./scan/selftest.mjs";

const OUT = process.env.SCAN_OUT ?? "scan-out";
const BUDGET_MS = Number(process.env.SCAN_BUDGET_MIN ?? 300) * 60_000;
const ONLY = process.env.SCAN_GAMES ? new Set(process.env.SCAN_GAMES.split(/[\s,]+/).filter(Boolean)) : null;
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 8);
const RETRY_FAILED_MS = 7 * 24 * 3600 * 1000;
const started = Date.now();
const timeLeft = () => BUDGET_MS - (Date.now() - started);

/* ---------- listes de cartes, par source ---------- */

const TCGDEX = "https://api.tcgdex.net/v2";
/** langue de l'app → langue TCGdex, dans l'ordre de priorité */
const POKEMON_LANGS = [
  ["fr", "fr"], ["en", "en"], ["ja", "ja"], ["de", "de"], ["es", "es"], ["it", "it"], ["pt", "pt"],
  ["ko", "ko"], ["zh", "zh-tw"], ["zh-cn", "zh-cn"], ["nl", "nl"], ["pl", "pl"], ["ru", "ru"], ["th", "th"], ["id", "id"]
];

/** cartes Pokémon d'une langue ; le détail d'une extension n'est relu que si son nombre de cartes a changé */
async function pokemon(appLang, tcgLang) {
  const statePath = join(OUT, "state", `pokemon-${appLang}.sets.json`);
  const prev = await readJson(statePath, {});
  const sets = await getJson(`${TCGDEX}/${tcgLang}/sets`, { delay: 100 });
  const next = {};
  for (const s of sets) {
    const total = s.cardCount?.total ?? 0;
    if (prev[s.id] && prev[s.id].total === total) {
      next[s.id] = prev[s.id];
      continue;
    }
    try {
      const full = await getJson(`${TCGDEX}/${tcgLang}/sets/${encodeURIComponent(s.id)}`, { delay: 100 });
      next[s.id] = {
        total,
        date: full.releaseDate ?? "",
        cards: (full.cards ?? []).filter((c) => c.image).map((c) => [c.id, `${c.image}/low.webp`])
      };
    } catch (e) {
      console.warn(`TCGdex ${tcgLang}/${s.id} : ${e.message}`);
      if (prev[s.id]) next[s.id] = prev[s.id];
    }
  }
  await writeJsonCompact(statePath, next);
  // les extensions les plus récentes d'abord : ce sont celles qu'on scanne le plus
  return Object.values(next)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .flatMap((s) => s.cards.map(([key, img]) => ({ key, img })));
}

const SCRYFALL_SKIPPED = new Set(["token", "memorabilia", "alchemy", "minigame", "treasure_chest", "vanguard"]);

/** Magic : fichier « default cards » de Scryfall (une ligne par impression), lu en flux */
async function magic() {
  const meta = await getJson("https://api.scryfall.com/bulk-data/default-cards", { delay: 100 });
  const file = join(tmpdir(), "scryfall-default-cards.json");
  const res = await fetch(meta.download_uri, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${meta.download_uri}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  const out = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim().replace(/,$/, "");
    if (!line.startsWith("{")) continue;
    const c = JSON.parse(line);
    if (c.digital || c.lang !== "en" || SCRYFALL_SKIPPED.has(c.set_type)) continue;
    const img = c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small;
    if (img) out.push({ key: `${c.set}/${c.collector_number}`, img, date: c.released_at ?? "" });
  }
  await rm(file, { force: true });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Yu-Gi-Oh! : toutes les cartes en une requête, une entrée par illustration */
async function yugioh() {
  const json = await getJson("https://db.ygoprodeck.com/api/v7/cardinfo.php", { delay: 200 });
  const out = [];
  for (const c of json.data ?? []) for (const im of c.card_images ?? []) if (im.image_url_small) out.push({ key: String(c.id), img: im.image_url_small });
  // identifiants les plus élevés ≈ cartes les plus récentes
  return out.sort((a, b) => Number(b.key) - Number(a.key));
}

async function lorcana() {
  const json = await getJson("https://api.lorcast.com/v0/sets", { delay: 150 });
  const sets = (Array.isArray(json) ? json : json.results ?? []).sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
  const out = [];
  for (const s of sets) {
    const rows = await getJson(`https://api.lorcast.com/v0/sets/${encodeURIComponent(s.code)}/cards`, { delay: 150 });
    for (const r of Array.isArray(rows) ? rows : rows.results ?? []) {
      const img = r.image_uris?.digital?.small;
      if (img) out.push({ key: s.code, img });
    }
  }
  return out;
}

const PUNK = "https://raw.githubusercontent.com/buhbbl/punk-records/main";
/** même correspondance que l'app (src/catalog/sources/punkrecords.ts) */
const PUNK_LISTS = {
  en: { folder: "english", dataFolder: "english" },
  fr: { folder: "french", dataFolder: "french" },
  ja: { folder: "english-asia", dataFolder: "japanese", prefix: "550" }
};

async function onepiece(lang) {
  const p = PUNK_LISTS[lang];
  const packs = Object.values(await getJson(`${PUNK}/${p.folder}/packs.json`, { delay: 50 }));
  const out = [];
  for (const row of packs.sort((a, b) => Number(b.id.slice(-3)) - Number(a.id.slice(-3)))) {
    const packId = p.prefix ? `${p.prefix}${row.id.slice(-3)}` : row.id;
    let cards;
    try {
      cards = await getJson(`${PUNK}/${p.dataFolder}/data/${packId}.json`, { delay: 50, retries: 1 });
    } catch {
      continue; // produit sans cartes dans cette langue
    }
    for (const c of cards) if (c.img_full_url) out.push({ key: packId, img: c.img_full_url });
  }
  return out;
}

async function riftAll(path, params = {}) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const qs = new URLSearchParams({ ...params, page: String(page), size: "100" });
    const json = await getJson(`https://api.riftcodex.com${path}?${qs}`, { delay: 120 });
    const items = Array.isArray(json) ? json : json.items ?? json.data ?? json.results ?? [];
    out.push(...items);
    const pages = Array.isArray(json) ? 1 : json.pages ?? (json.total ? Math.ceil(json.total / 100) : 1);
    if (page >= pages || !items.length) break;
  }
  return out;
}

async function riftbound() {
  const sets = (await riftAll("/sets")).sort((a, b) => (b.published_on ?? "").localeCompare(a.published_on ?? ""));
  const out = [];
  for (const s of sets) {
    for (const c of await riftAll("/cards", { set_id: s.set_id.toLowerCase(), sort: "collector_number" })) {
      if (c.media?.image_url) out.push({ key: s.set_id, img: c.media.image_url });
    }
  }
  return out;
}

/** licences du catalogue TCGplayer publiées par ce dépôt (cards/) */
async function tcgcatalog(game) {
  const index = await readJson("cards/index.json", { games: {} });
  const sets = [...(index.games[game]?.sets ?? [])].sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""));
  const out = [];
  for (const s of sets) {
    const data = await readJson(s.file, { cards: [] });
    for (const c of data.cards ?? []) if (c.image) out.push({ key: s.file, img: c.image });
  }
  return out;
}

/** fichiers publiés, dans l'ordre de priorité (le budget de temps s'épuise sur les derniers) */
const FILES = [
  ...POKEMON_LANGS.slice(0, 3).map(([l, t]) => ({ game: "pokemon", lang: l, list: () => pokemon(l, t) })),
  { game: "onepiece", lang: "en", list: () => onepiece("en") },
  { game: "onepiece", lang: "ja", list: () => onepiece("ja") },
  { game: "onepiece", lang: "fr", list: () => onepiece("fr") },
  { game: "lorcana", lang: "en", list: lorcana },
  { game: "riftbound", lang: "en", list: riftbound },
  { game: "dragonball", lang: "en", list: () => tcgcatalog("dragonball") },
  { game: "digimon", lang: "en", list: () => tcgcatalog("digimon") },
  { game: "palworld", lang: "en", list: () => tcgcatalog("palworld") },
  { game: "yugioh", lang: "en", list: yugioh },
  ...POKEMON_LANGS.slice(3).map(([l, t]) => ({ game: "pokemon", lang: l, list: () => pokemon(l, t) })),
  { game: "magic", lang: "en", list: magic }
].filter((f) => !ONLY || ONLY.has(f.game) || ONLY.has(`${f.game}-${f.lang}`));

// essai hors-ligne : SCAN_LIST_FILE remplace les sources par une liste [{ game, lang, entries: [{ key, img }] }]
if (process.env.SCAN_LIST_FILE) {
  const lists = JSON.parse(await readFile(process.env.SCAN_LIST_FILE, "utf8"));
  FILES.splice(0, FILES.length, ...lists.map((l) => ({ game: l.game, lang: l.lang, list: async () => l.entries })));
}

/* ---------- empreintes ---------- */

const ENTRY = 64;
/** adresse sans paramètre de version (« …png?260929 ») : même image, pas de nouveau calcul */
const bare = (u) => u.split("?")[0];

async function writeJsonCompact(path, data) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

/** empreintes déjà publiées : adresse de l'image → 64 octets */
async function previous(name) {
  const meta = await readJson(join(OUT, `${name}.json`), null);
  if (!meta || meta.fp !== FP_VERSION) return new Map();
  let bin;
  try {
    bin = await readFile(join(OUT, `${name}.bin`));
  } catch {
    return new Map();
  }
  const map = new Map();
  meta.imgs.forEach((img, i) => map.set(bare(img), bin.subarray(i * ENTRY, (i + 1) * ENTRY)));
  return map;
}

let sharp;
async function fingerprintImage(url, game) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), { lasting: [403, 404, 410].includes(res.status) });
  const buf = Buffer.from(await res.arrayBuffer());
  // pixels tels que décodés, à la taille d'origine : comme l'app
  let decoded;
  try {
    decoded = await sharp(buf, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (e) {
    throw Object.assign(e, { lasting: true }); // fichier qui n'est pas une image lisible
  }
  const { data, info } = decoded;
  const fp = fingerprintPixels(data, info.width, info.height, game);
  const out = Buffer.alloc(ENTRY);
  for (let i = 0; i < 8; i++) out.writeUInt32LE(fp.full[i], i * 4);
  for (let i = 0; i < 8; i++) out.writeUInt32LE(fp.art[i], 32 + i * 4);
  return out;
}

async function main() {
  console.log(`Empreintes conformes à l'app (${selfTest()} cas de test).`);
  sharp = (await import("sharp")).default;
  sharp.concurrency(1);
  await mkdir(join(OUT, "state"), { recursive: true });
  const failedPath = join(OUT, "state", "failed.json");
  const failed = await readJson(failedPath, {});
  const oldIndex = await readJson(join(OUT, "index.json"), { files: {} });
  const files = {};
  let computed = 0;

  for (const f of FILES) {
    const name = `${f.game}-${f.lang}`;
    if (timeLeft() < 5 * 60_000) {
      console.log(`${name} : plus de temps, index précédent conservé.`);
      if (oldIndex.fp === FP_VERSION && oldIndex.files?.[name]) files[name] = oldIndex.files[name];
      continue;
    }
    let entries;
    try {
      entries = await f.list();
    } catch (e) {
      console.warn(`${name} : liste indisponible (${e.message}), index précédent conservé.`);
      if (oldIndex.fp === FP_VERSION && oldIndex.files?.[name]) files[name] = oldIndex.files[name];
      continue;
    }
    // une adresse d'image = une entrée
    const seen = new Set();
    entries = entries.filter((e) => (seen.has(e.img) ? false : (seen.add(e.img), true)));
    const known = await previous(name);
    const hashes = new Map();
    for (const e of entries) if (known.has(bare(e.img))) hashes.set(e.img, known.get(bare(e.img)));
    const todo = entries.filter((e) => !hashes.has(e.img) && !(failed[e.img] && Date.now() - Date.parse(failed[e.img]) < RETRY_FAILED_MS));
    console.log(`${name} : ${entries.length} cartes, ${hashes.size} déjà traitées, ${todo.length} à traiter.`);

    let next = 0;
    let done = 0;
    let transient = 0;
    const worker = async () => {
      while (next < todo.length && timeLeft() > 3 * 60_000) {
        const e = todo[next++];
        try {
          hashes.set(e.img, await fingerprintImage(e.img, f.game));
          delete failed[e.img];
        } catch (err) {
          // image absente ou illisible : mise de côté une semaine ; panne passagère (réseau, 5xx, 429) : réessayée à la passe suivante
          if (err.lasting) failed[e.img] = new Date().toISOString();
          else transient++;
        }
        if (++done % 500 === 0) console.log(`  ${name} : ${done}/${todo.length}`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    computed += done;
    if (transient) console.warn(`  ${name} : ${transient} images injoignables pour l'instant, réessayées à la prochaine passe.`);

    const kept = entries.filter((e) => hashes.has(e.img));
    const bin = Buffer.concat(kept.map((e) => hashes.get(e.img)));
    const meta = { fp: FP_VERSION, game: f.game, lang: f.lang, keys: kept.map((e) => e.key), imgs: kept.map((e) => e.img) };
    await writeJsonCompact(join(OUT, `${name}.json`), meta);
    await writeFile(join(OUT, `${name}.bin`), bin);
    const version = createHash("sha1").update(bin).update(JSON.stringify(meta.keys)).digest("hex").slice(0, 12);
    files[name] = { game: f.game, lang: f.lang, count: kept.length, total: entries.length, bytes: bin.length, version };
    console.log(`${name} : ${kept.length}/${entries.length} cartes dans l'index.`);
  }

  // fichiers d'une passe précédente qui n'ont pas été traités cette fois (filtre SCAN_GAMES)
  if (oldIndex.fp === FP_VERSION) for (const [k, v] of Object.entries(oldIndex.files ?? {})) files[k] ??= v;
  await writeJsonCompact(failedPath, failed);
  await writeFile(
    join(OUT, "index.json"),
    JSON.stringify({ fp: FP_VERSION, updatedAt: new Date().toISOString(), files }, null, 1) + "\n"
  );
  console.log(`Terminé en ${Math.round((Date.now() - started) / 60_000)} min, ${computed} images traitées.`);
}

await main();
