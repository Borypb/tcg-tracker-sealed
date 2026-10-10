// Script 2 — décline la récolte anglaise dans d'autres langues.
// Pour chaque produit anglais, on cherche son équivalent probable : même extension
// (nom traduit par TCGdex), même type (gabarit de nom par langue), Pokémon traduits
// (PokeAPI). Ce qui ne se traduit pas proprement part dans review/ au lieu d'être inventé.
import { getJson, getText, norm, readJson, US_ONLY, writeJson } from "./lib.mjs";

const TCGDEX = "https://api.tcgdex.net/v2";
const SPECIES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";
const POKEAPI_LANG = { en: 9, fr: 5, de: 6, es: 7, it: 8, ja: 11, ko: 3 };

/** gabarits de noms par langue ; {set} = extension, {subject} = reste du nom traduit */
export const TEMPLATES = {
  fr: {
    etb: "Coffret Dresseur d'Élite {set}",
    booster_box: "Display {set}",
    bundle: "Bundle de 6 boosters {set}",
    upc: "Collection Ultra Premium {subject}",
    spc: "Collection Super Premium {subject}",
    build_battle: "Kit d'avant-première {set}",
    tin: "Pokébox {subject}",
    mini_tin: "Mini Pokébox {subject}",
    blister: "{blister} {subject}",
    collection: "Coffret {subject}",
    booster: "Booster {set}"
  }
};

/** mots courants des noms de produits, traduits ; les autres mots anglais bloquent la traduction */
const WORDS = {
  fr: {
    premium: "Premium", special: "spécial", figure: "avec figurine", pin: "avec pin's", poster: "avec poster",
    mega: "Méga", collection: "", box: "", tin: "", ex: "ex", v: "V", vmax: "VMAX",
    vstar: "VSTAR", gx: "GX", "tag team": "TAG TEAM", radiant: "radieux", ancient: "Antique", future: "Futur",
    league: "Ligue", battle: "combat", deck: "deck", trainer: "Dresseur", oversized: "jumbo", card: "carte",
    and: "et", with: "avec", "&": "et", international: "International", collector: "Collector", version: "version",
    power: "Puissance", powers: "Puissances", team: "Team", legends: "Légendes", of: "de", go: "GO",
    celebration: "Célébration", celebrations: "Célébrations", illustration: "Illustration", tournament: "Tournoi",
    mythical: "fabuleux", legendary: "légendaire", friends: "Amis", partners: "Partenaires", three: "trois",
    two: "deux", triple: "triple", fall: "automne", rocket: "Rocket", challenge: "défi", s: "", gift: "cadeau",
    holiday: "des fêtes", calendar: "calendrier", advent: "de l'Avent", surprise: "surprise", vault: "coffre",
    kanto: "Kanto", johto: "Johto", hoenn: "Hoenn", sinnoh: "Sinnoh", unova: "Unys", kalos: "Kalos",
    alola: "Alola", galar: "Galar", paldea: "Paldea", hisui: "Hisui", first: "premier", starter: "Starter",
    starters: "Starters", ultra: "Ultra", great: "Super", master: "Master", quick: "Rapide", heavy: "Masse"
  }
};

/** expressions de plusieurs mots, traduites avant le découpage en mots */
const PHRASES = {
  fr: [
    [/\bpok[eé] ball\b/gi, "Poké Ball"],
    [/\bknock out\b/gi, "K.O."],
    [/\bback to school\b/gi, "rentrée"],
    [/\btag team\b/gi, "TAG TEAM"],
    [/\btech sticker\b/gi, "avec autocollants"],
    [/\bstacking\b/gi, "empilable"],
    [/\bpin collection\b/gi, "avec pin's"],
    [/\bfigure collection\b/gi, "avec figurine"],
    [/\bcollector'?s? chest\b/gi, "coffre collector"]
  ]
};

/** qualificatifs placés avant le Pokémon en anglais, après en français */
const REGIONS = {
  fr: {
    alolan: "d'Alola",
    galarian: "de Galar",
    hisuian: "d'Hisui",
    paldean: "de Paldea",
    shiny: "chromatique",
    teamrocketof: "de la Team Rocket"
  }
};

/** nom du blister selon le nombre de boosters */
const BLISTER = {
  fr: (en) =>
    /\b(single|1)[- ]?pack\b|single blister/i.test(en)
      ? "Blister"
      : /\b(2|two)[- ]?pack\b/i.test(en)
        ? "Duopack"
        : /\b(3|three)[- ]?pack\b/i.test(en)
          ? "Tripack"
          : "Blister"
};

/** boosters contenus, quand la règle est stable pour une époque */
function boosterCount(kind, setCode) {
  const era = (setCode ?? "").replace(/[\d.].*$/, "").toLowerCase();
  if (kind === "etb") return ["sv", "me"].includes(era) ? 9 : ["swsh", "sm", "xy"].includes(era) ? 8 : undefined;
  if (kind === "booster_box") return 36;
  if (kind === "bundle") return 6;
  if (kind === "build_battle") return 4;
  if (kind === "booster") return 1;
  return undefined;
}

async function speciesTable(lang) {
  const csv = await getText(SPECIES_CSV);
  const en = new Map();
  const target = new Map();
  for (const line of csv.split("\n").slice(1)) {
    const [id, langId, name] = line.split(",");
    if (Number(langId) === POKEAPI_LANG.en) en.set(id, name);
    if (Number(langId) === POKEAPI_LANG[lang]) target.set(id, name);
  }
  const map = new Map();
  for (const [id, name] of en) if (target.has(id)) map.set(norm(name), target.get(id));
  return map;
}

const KIND_WORDS =
  /\b(elite trainer box|ultra[- ]premium collection|super[- ]premium collection|premium collection|booster bundle|booster box|booster display|display|build (?:&|and) battle (?:box|stadium)|mini tins?|tins?|(?:single|sleeved|checklane|\d)[- ]pack blisters?|blisters?|checklane|single pack|booster packs?|sleeved booster|collections?|box|chest|pack|single|mini)\b/gi;

/** remplace les noms d'extensions anglais cités dans un titre par leur nom local (protégé) */
function replaceSetNames(text, enSets, localSets) {
  let found;
  let out = text;
  const byLength = [...enSets.entries()].filter(([, n]) => n.length >= 4).sort((a, b) => b[1].length - a[1].length);
  for (const [id, en] of byLength) {
    const re = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(out)) continue;
    const local = localSets.get(id);
    if (!local) continue;
    out = out.replace(re, ` §${local.replace(/\s/g, "_")} `);
    found ??= id;
  }
  return { text: out, setCode: found };
}

/**
 * Traduit le « sujet » d'un nom (ce qui reste une fois l'extension et le type retirés).
 * Renvoie null si un mot anglais reste sans traduction.
 */
export function translateSubject(raw, lang, species) {
  const words = WORDS[lang];
  const regions = REGIONS[lang];
  let text = raw.replace(/\bteam rocket['’]s\b/gi, " teamrocketof ");
  for (const [re, fr] of PHRASES[lang] ?? []) text = text.replace(re, ` §${fr.replace(/\s/g, "_")} `);
  const tokens = text
    .replace(/[()[\],:]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith("§")) {
      out.push(tokens[i].slice(1).replace(/_/g, " "));
      continue;
    }
    let matched = false;
    // espèces sur 1 à 3 mots (« Mr. Mime », « Tapu Koko »…), la plus longue d'abord
    for (let len = 3; len >= 1 && !matched; len--) {
      const chunk = tokens.slice(i, i + len).join(" ");
      const fr = species.get(norm(chunk));
      if (!fr) continue;
      const prev = norm(tokens[i - 1] ?? "");
      if (regions[prev]) out[out.length - 1] = `${fr} ${regions[prev]}`;
      else if (prev === "mega" && out.length) out[out.length - 1] = `Méga-${fr}`;
      else out.push(fr);
      i += len - 1;
      matched = true;
    }
    if (matched) continue;
    const t = norm(tokens[i]);
    if (regions[t]) {
      out.push(`__${t}`); // remplacé si une espèce suit
      continue;
    }
    if (/^\d+$/.test(t) || /^[a-z]$/.test(t)) {
      out.push(tokens[i]);
      continue;
    }
    // suffixes de cartes : on garde la casse d'origine (EX de l'époque XY, ex d'Écarlate et Violet)
    if (/^(ex|gx|v|vmax|vstar|break|lv\.x)$/i.test(tokens[i])) {
      out.push(tokens[i]);
      continue;
    }
    if (t in words) {
      if (words[t]) out.push(words[t]);
      continue;
    }
    return null;
  }
  if (out.some((w) => w.startsWith("__"))) return null;
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export async function localize(game, lang) {
  const raw = await readJson(`raw/${game}-en.json`, null);
  if (!raw) throw new Error(`raw/${game}-en.json absent : lance d'abord harvest.mjs`);
  const templates = TEMPLATES[lang];
  const species = await speciesTable(lang);
  const enSets = new Map((await getJson(`${TCGDEX}/en/sets`, { delay: 0 })).map((s) => [s.id, s.name]));
  const localSets = new Map((await getJson(`${TCGDEX}/${lang}/sets`, { delay: 0 })).map((s) => [s.id, s.name]));

  const products = new Map();
  const review = [];
  for (const group of Object.values(raw.groups)) {
    for (const p of group.products) {
      const template = templates[p.kind];
      if (!template) continue;
      if (US_ONLY.test(p.name)) continue;
      // extension citée dans le titre quand le groupe TCGplayer n'en est pas une
      const cited = replaceSetNames(p.name, enSets, localSets);
      const setCode = group.setCode ?? cited.setCode;
      const setName = setCode ? localSets.get(setCode) : undefined;
      const needsSet = template.includes("{set}");
      if (needsSet && !setName) {
        review.push({ reason: setCode ? `extension absente en ${lang}` : "extension inconnue", ...p, group: group.name });
        continue;
      }
      // éditions : contenu entre crochets (« [Koraidon] »)
      const bracket = p.name.match(/\[([^\]]+)\]/)?.[1];
      let subject = "";
      if (template.includes("{subject}")) {
        const enSet = setCode ? enSets.get(setCode) ?? "" : "";
        const withoutOwnSet = p.name
          .replace(/\[[^\]]*\]/g, " ")
          .replace(/^[A-Z]{1,4}\d*[a-z]?:\s*/, "")
          .replace(new RegExp(`\\b${enSet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
        const stripped = replaceSetNames(withoutOwnSet, enSets, localSets).text
          .replace(/\bpok[eé]mon(?! go)( tcg)?\b|\btcg\b|\bscarlet (?:&|and) violet\b|\bsword (?:&|and) shield\b|\bmega evolution\b/gi, " ")
          .replace(KIND_WORDS, " ");
        const tr = translateSubject(stripped, lang, species);
        if (tr === null) {
          review.push({ reason: "mots non traduits", ...p, group: group.name });
          continue;
        }
        subject = tr || setName || "";
        if (!subject) {
          review.push({ reason: "nom vide après traduction", ...p, group: group.name });
          continue;
        }
      }
      const name = template
        .replace("{blister}", BLISTER[lang]?.(p.name) ?? "Blister")
        .replace("{set}", setName ?? "")
        .replace("{subject}", subject)
        .replace(/\s+/g, " ")
        .trim();
      const edition = bracket ? translateSubject(bracket, lang, species) : undefined;
      // un seul ETB / display… par extension, et un seul produit par nom :
      // les éditions visuelles (« [Day] », « [Night] ») sont regroupées
      const byName = !needsSet && [...products.values()].find((x) => x.name === name && x.kind === p.kind);
      const id = needsSet ? `pkm-${lang}-${setCode}-${p.kind}` : byName ? byName.id : `pkm-${lang}-tcp${p.tcgplayerId}`;
      const prev = products.get(id);
      if (prev) {
        if (edition && !prev.editions?.includes(edition)) prev.editions = [...(prev.editions ?? []), edition];
        continue;
      }
      const qty = boosterCount(p.kind, setCode);
      products.set(id, {
        id,
        kind: p.kind,
        name,
        lang,
        setIds: setCode ? [`pkm-${setCode}`] : undefined,
        releasedAt: p.releasedOn,
        contents: qty && setCode ? [{ type: "booster", setId: `pkm-${setCode}`, qty }] : undefined,
        editions: edition ? [edition] : undefined,
        image: p.image,
        imageLang: "en",
        derived: { from: `tcgplayer:${p.tcgplayerId}`, en: p.name }
      });
    }
  }
  await writeJson(`generated/${game}-${lang}.json`, [...products.values()]);
  await writeJson(`review/${game}-${lang}.json`, review);
  console.log(`${game}/${lang} : ${products.size} produits déduits, ${review.length} à revoir`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const lang of Object.keys(TEMPLATES)) await localize("pokemon", lang);
}
