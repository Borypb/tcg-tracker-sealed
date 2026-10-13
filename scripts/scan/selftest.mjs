// Vérifie que le calcul d'empreinte est identique à celui de l'app (vecteur généré par l'app).
import { readFileSync } from "node:fs";
import { FP_VERSION, fingerprintPixels, toHex, vectorImage } from "./fingerprint.mjs";

export function selfTest() {
  const vector = JSON.parse(readFileSync(new URL("./vector.json", import.meta.url), "utf8"));
  if (vector.fp !== FP_VERSION) throw new Error(`vecteur pour la version ${vector.fp}, calcul en version ${FP_VERSION}`);
  for (const c of vector.cases) {
    const fp = fingerprintPixels(vectorImage(c.w, c.h, c.seed), c.w, c.h, c.game);
    if (toHex(fp.full) !== c.full || toHex(fp.art) !== c.art) throw new Error(`empreinte différente de l'app (${c.w}×${c.h}, ${c.game})`);
  }
  return vector.cases.length;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(`empreintes conformes à l'app (${selfTest()} cas) ✓`);
