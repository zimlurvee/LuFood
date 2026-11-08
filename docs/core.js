// LuFood core in plain JavaScript (no Deno-specific APIs, so it also runs in Node for testing).
// Port of the Python backend: app/core.py (features), app/simulate.py (growth reference), app/ml.py (prediction + explanations).
import { MODEL } from "./model.js";

export const FOODS = { chicken: "cooked chicken", rice: "cooked rice" };
export const LABELS = ["low", "moderate", "high"];
const PARAMS = { // PLACEHOLDER growth parameters, same as app/simulate.py
  "cooked rice": { organism: "B. cereus", b: 0.024, tmin: 7, topt: 37, h0: 0.5, max: 6 },
  "cooked chicken": { organism: "Salmonella", b: 0.024, tmin: 5, topt: 37, h0: 0.5, max: 6 },
};
const REC = {
  low: "Time in the danger zone is short. Refrigerate promptly at 5 °C or below and finish it within a day or two.",
  moderate: "This food has spent a notable time in the danger zone. Eat it right away, or discard it if you're unsure. Don't put it back in the fridge to eat later.",
  high: "Long exposure to unsafe temperatures. Discard it. Reheating will not remove toxins that some bacteria, such as B. cereus, can produce.",
};
const FOOD_REC = {
  chicken: " Keep cooked chicken at 60 °C or above, or at 5 °C or below.",
  rice: " Cool cooked rice quickly and refrigerate it within an hour or two.",
};
export const DISCLAIMER = "Decision-support estimate only, not a guarantee that food is safe. It cannot detect pathogens, toxins, allergens or chemicals. The model is trained on simulated data with placeholder growth parameters and has not been validated against real microbiological data.";

export class InputError extends Error {}

export function parseAssess(body) {
  const b = body || {};
  if (!(b.food in FOODS)) throw new InputError("food must be 'chicken' or 'rice'.");
  const total = Number(b.total_hours);
  if (!(total > 0 && total <= 168)) throw new InputError("total_hours must be above 0 and at most 168.");
  if (!Array.isArray(b.readings) || b.readings.length < 1 || b.readings.length > 50) throw new InputError("Give between 1 and 50 readings.");
  const readings = b.readings.map((r) => [Number(r.hour), Number(r.temp_c)]);
  for (const [h, t] of readings) {
    if (!(h >= 0 && h <= total)) throw new InputError("Each reading's hour must be between 0 and total_hours.");
    if (!(t >= -40 && t <= 150)) throw new InputError("Temperatures must be between -40 and 150 °C.");
  }
  return { food: b.food, total, readings };
}

export function featuresFromReadings(food, total, readings) {
  const r = [...readings].sort((a, b) => a[0] - b[0]);   // stable sort
  let danger = 0;
  r.forEach(([h, t], i) => {
    const next = i + 1 < r.length ? r[i + 1][0] : total;
    if (t > 5 && t < 60) danger += next - h;               // each reading holds until the next one
  });
  const temps = r.map((x) => x[1]);
  const max = Math.max(...temps), min = Math.min(...temps);
  return {
    latest_temp: temps[temps.length - 1], mean_temp: temps.reduce((a, b) => a + b, 0) / temps.length,
    max_temp: max, temp_range: max - min, total_hours: total, danger_hours: danger,
    "food_cooked chicken": food === "chicken" ? 1 : 0, "food_cooked rice": food === "rice" ? 1 : 0,
  };
}

export function predictProba(x) {                          // x: numbers in MODEL.features order
  const p = [0, 0, 0];
  for (const t of MODEL.trees) {
    let n = 0;
    while (t.l[n] >= 0) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
    const v = t.p[n];
    p[0] += v[0]; p[1] += v[1]; p[2] += v[2];
  }
  return p.map((a) => a / MODEL.trees.length);
}
export const riskScore = (p) => p[1] + 2 * p[2];            // smooth 0-2 risk level

function rng(seed) {                                        // mulberry32: small, deterministic
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Sampled Shapley values on the risk score, switching features from the training average to this food's value.
// Contributions add up exactly to riskScore(food) - riskScore(average food).
export function contributions(x, nPerm = 24) {
  const bg = MODEL.features.map((f) => MODEL.background[f]), d = x.length, rand = rng(0), phi = new Array(d).fill(0);
  for (let k = 0; k < nPerm; k++) {
    const order = [...Array(d).keys()];
    for (let i = d - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const cur = [...bg];
    let prev = riskScore(predictProba(cur));
    for (const j of order) { cur[j] = x[j]; const s = riskScore(predictProba(cur)); phi[j] += s - prev; prev = s; }
  }
  return MODEL.features.map((f, j) => ({ feature: f, value: Math.round((phi[j] / nPerm) * 1e4) / 1e4 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function growth(readings, total, p) {
  const r = [...readings].sort((a, b) => a[0] - b[0]);
  let exposure = 0;
  r.forEach(([h, t], i) => {
    const next = i + 1 < r.length ? r[i + 1][0] : total;
    if (t > p.tmin) exposure += (p.b * (Math.min(t, p.topt) - p.tmin)) ** 2 * (next - h);
  });
  return Math.min(Math.max(exposure - p.h0, 0), p.max);
}

export function assess(food, total, readings) {
  const feats = featuresFromReadings(food, total, readings);
  const x = MODEL.features.map((f) => feats[f]);
  const proba = predictProba(x);
  const modelLabel = LABELS[proba.indexOf(Math.max(...proba))];
  const par = PARAMS[FOODS[food]], inc = growth(readings, total, par), dz = feats.danger_hours;
  const r2 = (v) => Math.round(v * 100) / 100;
  // The model's cut-offs are placeholders, so never be less cautious than the 2h/4h guideline.
  const rule = dz <= 2 ? "low" : dz <= 4 ? "moderate" : "high";
  const label = LABELS[Math.max(LABELS.indexOf(modelLabel), LABELS.indexOf(rule))];
  return {
    label, model_label: modelLabel, note: label !== modelLabel ? "Showing the more cautious of the model and the 2-hour/4-hour guideline." : "", probabilities: Object.fromEntries(LABELS.map((l, i) => [l, Math.round(proba[i] * 1e4) / 1e4])),
    contributions: contributions(x), explanation_method: "sampling-shapley", features: feats,
    recommendation: REC[label] + FOOD_REC[food],
    reference: { organism: par.organism, danger_hours: r2(dz), rule_label: rule,
      growth_log10_increase: r2(inc), growth_label: inc < 1 ? "low" : inc < 2 ? "moderate" : "high" },
    model: { name: MODEL.name, metrics: MODEL.metrics }, disclaimer: DISCLAIMER,
  };
}
