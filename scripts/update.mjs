// Chaîne complète : récolte → déclinaison des langues → assemblage.
import { harvest, SOURCES } from "./harvest.mjs";
import { localize, TEMPLATES } from "./localize.mjs";
import { build } from "./build.mjs";

for (const [game, sources] of Object.entries(SOURCES)) {
  for (const src of sources) await harvest(game, src);
  for (const lang of Object.keys(TEMPLATES)) await localize(game, lang);
}
await build();
