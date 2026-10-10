# TCG Tracker – Produits scellés

Catalogue public des produits scellés (coffrets Dresseur d'Élite, displays, collections Ultra Premium, Pokébox…) utilisé par **TCG Tracker**, l'album TCG local-first.

L'app lit ce dépôt en lecture seule. Elle ne lui envoie rien, et ta collection reste sur ton appareil.

## Structure

```
index.json             # versions, libellés des types, un fichier par licence et par langue
pokemon-fr.json        # fichiers lus par l'app (générés, ne pas modifier à la main)
pokemon-en.json
pokemon-ja.json
curated/               # catalogue vérifié à la main : prioritaire sur tout le reste
raw/                   # récolte brute (script 1)
generated/             # produits déduits dans d'autres langues (script 2)
review/                # produits que le script 2 n'a pas su traduire, à compléter à la main
scripts/               # harvest.mjs → localize.mjs → build.mjs (update.mjs enchaîne les trois)
```

## Mise à jour automatique

Une GitHub Action (`.github/workflows/update.yml`) tourne chaque nuit, et à la demande depuis l'onglet Actions :

1. **Récolte** (`harvest.mjs`) : produits scellés du catalogue TCGplayer via [TCGCSV](https://tcgcsv.com) (anglais et japonais),
   rattachés aux extensions TCGdex. Seules les extensions modifiées depuis la veille sont retéléchargées.
   **Japonais** (`harvest-jp.mjs`) : catalogue officiel de [pokemon-card.com](https://www.pokemon-card.com/products/)
   (noms japonais officiels, dates, prix en yens, contenu). TCGplayer ne sert plus qu'aux BOX, absentes du site officiel.
2. **Déclinaison** (`localize.mjs`) : à partir de la récolte anglaise, propose l'équivalent français de chaque produit :
   nom de l'extension traduit par TCGdex, gabarit par type (« Coffret Dresseur d'Élite … »), Pokémon traduits via PokeAPI.
   Les exclusivités d'enseignes américaines, cartons de distribution et présentoirs sont écartés.
   Les produits que les règles ne savent pas nommer sont traduits un par un dans `curated/translations-fr.json`
   (généré par `scripts/data/translations-fr.py`, noms de Pokémon tirés de la table officielle PokeAPI).
   Ce qui reste sans traduction va dans `review/`.
3. **Assemblage** (`build.mjs`) : fusionne `curated/` (prioritaire), `generated/` et `raw/`,
   et n'incrémente la version d'un fichier que si son contenu a changé.

4. **Cotes** (`prices.mjs`) : cote du marché secondaire, distincte du prix de sortie (`msrp`).
   Cardmarket (fichiers publics du jour, en €) et TCGplayer (via TCGCSV, en $), dans `prices-pokemon.json`,
   un fichier à part qui change chaque jour sans faire changer la version du catalogue.
   Une fiche Cardmarket de produit scellé couvre toutes les langues européennes : la cote est « toutes langues ».
   Les boîtes « 1st Edition », que Cardmarket ne distingue pas, restent sans cote plutôt qu'avec une cote fausse.

5. **Taux de change** (`fx.mjs`) : taux de référence de la BCE (1 € = x devise) dans `fx.json`.
   L'app les prend d'abord chez Frankfurter (même source BCE) et se rabat sur ce fichier si besoin.

Les produits déduits portent un champ `derived` (nom anglais d'origine) ; ceux du catalogue manuel, `verified: true`.

## index.json

```json
{
  "version": 1,
  "updatedAt": "2026-10-10",
  "kinds": { "etb": "Coffret Dresseur d'Élite", "booster_box": "Display" },
  "games": {
    "pokemon": {
      "files": {
        "fr": { "file": "pokemon-fr.json", "version": 3, "count": 412 },
        "en": { "file": "pokemon-en.json", "version": 7, "count": 2180 }
      }
    }
  }
}
```

L'app télécharge `index.json` (une fois par jour au plus), puis seulement les fichiers dont la `version` a changé.
Les versions sont gérées par `build.mjs` : pour corriger un produit, modifie `curated/` puis lance `node scripts/build.mjs`
(ou laisse l'Action de la nuit s'en charger).

## Format d'un produit

```json
{
  "id": "pkm-fr-sv03-etb",
  "kind": "etb",
  "name": "Coffret Dresseur d'Élite Flammes Obsidiennes",
  "lang": "fr",
  "setIds": ["pkm-sv03"],
  "releasedAt": "2023-08-11",
  "contents": [
    { "type": "booster", "setId": "pkm-sv03", "qty": 9 },
    { "type": "promo", "cardId": "pkm-svp:056:fr:holo" }
  ],
  "extras": ["65 protège-cartes", "45 cartes Énergie"],
  "editions": ["Koraidon", "Miraidon"],
  "image": "images/pkm-fr-sv03-etb.webp",
  "msrp": { "eur": 54.99 },
  "aliases": ["etb", "flammes obsidiennes"]
}
```

| Champ | Obligatoire | Rôle |
|---|---|---|
| `id` | oui | `<licence>-<langue>-<extension>-<type>`, unique et **jamais modifié** (les albums s'y réfèrent) |
| `kind` | oui | une clé de `kinds` dans `index.json` |
| `name` | oui | nom commercial dans la langue du produit |
| `lang` | oui | `fr`, `en`, `ja`… |
| `setIds` | non | extensions liées, mêmes identifiants que l'app (`pkm-sv03`, `op-op09`, `mtg-woe`…) |
| `releasedAt` | non | date de sortie `AAAA-MM-JJ` |
| `contents` | non | boosters (`setId`, `qty`) et cartes promo (`cardId` au format de l'app, ou `name` à défaut) |
| `extras` | non | accessoires, en texte libre |
| `editions` | non | versions visuelles d'un même produit (couvertures différentes, même contenu) |
| `image` | non | chemin dans ce dépôt ou URL |
| `msrp` | non | prix public conseillé |
| `aliases` | non | mots-clés pour la recherche |

## Couverture

- Pokémon : tout le catalogue scellé TCGplayer en anglais et en japonais ; en français, les équivalents déduits
  plus le catalogue vérifié (ETB et displays Écarlate et Violet / Méga-Évolution, Collection Ultra Premium 151).
- À venir : autres licences, autres langues européennes.

Non affilié à Nintendo, The Pokémon Company, Bandai, Wizards of the Coast, Konami, Ravensburger, Riot Games, Pocketpair.
