// Empreinte visuelle d'une carte : copie conforme du calcul de l'app (src/lib/fingerprint.ts de Thothectio).
// pHash 256 bits (DCT 64 × 64, 16 × 16 basses fréquences, seuil à la médiane), sur la carte entière
// (bordure exclue) et sur l'illustration (zone selon la licence).
// Toute modification doit être faite des deux côtés et changer FP_VERSION : `vector.json` le vérifie.

export const FP_VERSION = 1;
export const FP_WORDS = 8;
const FP_BITS = FP_WORDS * 32;

export const FULL_ZONE = { x: 0.07, y: 0.05, w: 0.86, h: 0.9 };
const DEFAULT_ART = { x: 0.1, y: 0.125, w: 0.8, h: 0.37 };
export const ART_ZONES = {
  pokemon: DEFAULT_ART,
  magic: { x: 0.1, y: 0.125, w: 0.8, h: 0.4 },
  yugioh: { x: 0.14, y: 0.2, w: 0.72, h: 0.5 },
  lorcana: { x: 0.08, y: 0.07, w: 0.84, h: 0.45 },
  onepiece: { x: 0.08, y: 0.1, w: 0.84, h: 0.48 },
  riftbound: { x: 0.08, y: 0.08, w: 0.84, h: 0.46 }
};
export const artZone = (game) => ART_ZONES[game] ?? DEFAULT_ART;

const N = 64;
const K = 16;
const COS = (() => {
  const t = new Float64Array(K * N);
  for (let k = 0; k < K; k++) for (let n = 0; n < N; n++) t[k * N + n] = Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N));
  return t;
})();

export function lumaPlane(rgba, w, h) {
  const W1 = w + 1;
  const sat = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      row += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
    }
  }
  return { sat, w, h };
}

export function grayZonePlane(p, zone, size = N) {
  const { sat, w, h } = p;
  const W1 = w + 1;
  const out = new Float32Array(size * size);
  const x0 = zone.x * w;
  const y0 = zone.y * h;
  const zw = zone.w * w;
  const zh = zone.h * h;
  const xs = new Int32Array(size + 1);
  const ys = new Int32Array(size + 1);
  for (let k = 0; k <= size; k++) {
    xs[k] = Math.min(w, Math.max(0, Math.round(x0 + (k * zw) / size)));
    ys[k] = Math.min(h, Math.max(0, Math.round(y0 + (k * zh) / size)));
  }
  for (let oy = 0; oy < size; oy++) {
    let ya = ys[oy];
    let yb = ys[oy + 1];
    if (yb <= ya) (yb = Math.min(h, ya + 1)), (ya = yb - 1);
    for (let ox = 0; ox < size; ox++) {
      let xa = xs[ox];
      let xb = xs[ox + 1];
      if (xb <= xa) (xb = Math.min(w, xa + 1)), (xa = xb - 1);
      const sum = sat[yb * W1 + xb] - sat[ya * W1 + xb] - sat[yb * W1 + xa] + sat[ya * W1 + xa];
      out[oy * size + ox] = sum / ((xb - xa) * (yb - ya));
    }
  }
  return out;
}

export function phash(gray) {
  const rows = new Float64Array(N * K);
  for (let y = 0; y < N; y++) {
    const r = y * N;
    for (let k = 0; k < K; k++) {
      const c = k * N;
      let s = 0;
      for (let x = 0; x < N; x++) s += gray[r + x] * COS[c + x];
      rows[y * K + k] = s;
    }
  }
  const coef = new Float64Array(K * K);
  for (let k1 = 0; k1 < K; k1++) {
    const c = k1 * N;
    for (let k2 = 0; k2 < K; k2++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += COS[c + y] * rows[y * K + k2];
      coef[k1 * K + k2] = s;
    }
  }
  const sorted = Float64Array.from(coef).sort();
  const median = (sorted[127] + sorted[128]) / 2;
  const out = new Uint32Array(FP_WORDS);
  for (let i = 0; i < FP_BITS; i++) if (coef[i] > median) out[i >>> 5] |= 1 << (i & 31);
  return out;
}

/** empreintes d'une image de carte entière (pixels RGBA à sa taille d'origine) */
export function fingerprintPixels(rgba, w, h, game) {
  const p = lumaPlane(rgba, w, h);
  return { full: phash(grayZonePlane(p, FULL_ZONE)), art: phash(grayZonePlane(p, artZone(game))) };
}

export const toHex = (h) => Array.from(h, (w) => w.toString(16).padStart(8, "0")).join("");

/** image de test déterministe (vecteur partagé avec l'app) */
export function vectorImage(w, h, seed) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = (x * 7 + y * 3 + seed * 31) % 256;
      out[i + 1] = Math.round(128 + 120 * Math.sin((x + seed) / 9) * Math.cos(y / 13));
      out[i + 2] = ((x * y + seed * 17) >> 3) % 256;
      out[i + 3] = 255;
    }
  return out;
}
