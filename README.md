# TCG Tracker – Produits scellés

Catalogue public des produits scellés (coffrets Dresseur d'Élite, displays, collections Ultra Premium, Pokébox…) utilisé par **TCG Tracker**, l'album TCG local-first.

L'app lit ce dépôt en lecture seule. Elle ne lui envoie rien, et ta collection reste sur ton appareil.

## Structure

```
index.json      # version globale, libellés des types, un fichier par licence
pokemon.json    # produits Pokémon
images/         # (optionnel) visuels des produits, <id>.webp
```

## index.json

```json
{
  "version": 1,
  "updatedAt": "2026-10-10",
  "kinds": { "etb": "Coffret Dresseur d'Élite", "booster_box": "Display" },
  "games": {
    "pokemon": { "file": "pokemon.json", "version": 1, "count": 31 }
  }
}
```

L'app télécharge `index.json` (une fois par jour au plus), puis seulement les fichiers de licence dont la `version` a changé.
**Quand tu modifies `pokemon.json`, incrémente sa `version` ici, sinon les apps ne verront pas la mise à jour.**

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

- Pokémon (FR) : coffrets Dresseur d'Élite et displays des blocs Écarlate et Violet et Méga-Évolution, Collection Ultra Premium 151.
- À compléter : Pokébox, tripacks, coffrets collection, autres blocs, autres licences.

Non affilié à Nintendo, The Pokémon Company, Bandai, Wizards of the Coast, Konami, Ravensburger, Riot Games, Pocketpair.
