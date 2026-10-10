// Taux de change de référence de la BCE (1 EUR = x devise), publiés chaque jour ouvré vers 16 h.
// Sortie : fx.json — secours de l'app quand Frankfurter ne répond pas.
import { writeFile } from "node:fs/promises";

const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export async function fx() {
  const res = await fetch(ECB);
  if (!res.ok) throw new Error(`BCE : réponse ${res.status}`);
  const xml = await res.text();
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rates = Object.fromEntries([...xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)].map((m) => [m[1], Number(m[2])]));
  if (!date || Object.keys(rates).length < 10) throw new Error("BCE : format inattendu");
  await writeFile("fx.json", JSON.stringify({ base: "EUR", date, source: "BCE", rates }, null, 1) + "\n");
  console.log(`Taux BCE du ${date} : ${Object.keys(rates).length} devises`);
}

if (import.meta.url === `file://${process.argv[1]}`) await fx();
