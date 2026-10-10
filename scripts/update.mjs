// Chaîne complète : récolte → déclinaison des langues → assemblage.
import { harvest, SOURCES } from "./harvest.mjs";
import { harvestJpOfficial } from "./harvest-jp.mjs";
import { localize, TEMPLATES } from "./localize.mjs";
import { build } from "./build.mjs";
import { prices } from "./prices.mjs";

for (const [game, sources] of Object.entries(SOURCES)) {
  for (const src of sources) await harvest(game, src);
  if (game === "pokemon") {
    try {
      await harvestJpOfficial();
    } catch (e) {
      // on garde la récolte précédente si le site officiel ne répond pas
      console.warn("Catalogue officiel japonais indisponible :", e.message);
    }
  }
  for (const lang of Object.keys(TEMPLATES)) await localize(game, lang);
}
await build();
// cotes du jour (fichier séparé : le catalogue ne change pas de version chaque jour)
await prices("pokemon", "pkm");
