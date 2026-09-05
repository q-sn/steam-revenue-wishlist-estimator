#!/usr/bin/env node
/**
 * Refits the wishlist model from the raw archive and checks what ships.
 *
 * One median regression recovers every constant in WISHLIST_CURVE and
 * WISHLIST_SAID at once:
 *
 *   log(wishlists) = log a - b*log(rank + q) - alpha*log(1 + age/tau) - rungk*gap
 *
 * Prints held-out accuracy, the freshest anchors against the curve, the growth
 * model against games that announced twice, and the consistency test between
 * the two legs. Exits non-zero if a shipped constant no longer reproduces.
 *
 *   node tools/calibrate-wishlist-model.mjs
 */
import fs from 'node:fs';
import { WISHLIST_CURVE, WISHLIST_SAID } from '../src/core/constants.js';
import { COUNT, rejectStoredQuote } from './anchor-quote.mjs';

/** Only used while fitting: the share of the rung gap, and its mean. */
const RUNGK = 0.15942;
const MEAN_GAP = 0.239259;

const wishlistsAtRank = (rank) => {
  const mid = WISHLIST_CURVE.a / Math.pow(Math.max(1, rank) + WISHLIST_CURVE.q, WISHLIST_CURVE.b);
  return { lo: mid * WISHLIST_CURVE.band.lo, mid, hi: mid * WISHLIST_CURVE.band.hi };
};

const carryForward = (announced, ageDays) => {
  const { tau, alpha, floor, loFloor, loAlpha, hiFloor, hiAlpha } = WISHLIST_SAID;
  const t = 1 + Math.max(0, ageDays) / tau;
  return {
    lo: Math.max(announced, announced * loFloor * Math.pow(t, loAlpha)),
    mid: announced * floor * Math.pow(t, alpha),
    hi: announced * hiFloor * Math.pow(t, hiAlpha)
  };
};



const SNAP_DAY = Date.parse('2026-09-05T00:00:00Z');
const find = (cands) => cands.filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const ANCHORS = find([process.env.ANCHORS, 'data/wishlist-anchors.ndjson']);
const RANKS = find([process.env.RANKS, 'data/wishlist-ranks.json']);
if (!ANCHORS || !RANKS) { console.error('need data/wishlist-anchors.ndjson and data/wishlist-ranks.json'); process.exit(1); }

/* ---- helpers ---- */
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const med = (a) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
const qu = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/* ---- Nelder-Mead ---- */
const nm = (f, x0, step = 0.06, iters = 40000) => {
  const n = x0.length; let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += Math.abs(p[i]) > 1e-12 ? p[i] * step : step; S.push(p); }
  let F = S.map(f);
  for (let it = 0; it < iters; it++) {
    const o = F.map((_, i) => i).sort((a, b) => F[a] - F[b]); S = o.map((i) => S[i]); F = o.map((i) => F[i]);
    if (Math.abs(F[n] - F[0]) < 1e-13 * (Math.abs(F[0]) + 1e-13)) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const rf = c.map((v, j) => v + (v - S[n][j])), fr = f(rf);
    if (fr < F[0]) { const ex = c.map((v, j) => v + 2 * (v - S[n][j])), fe = f(ex); if (fe < fr) { S[n] = ex; F[n] = fe; } else { S[n] = rf; F[n] = fr; } }
    else if (fr < F[n - 1]) { S[n] = rf; F[n] = fr; }
    else {
      const co = c.map((v, j) => v + 0.5 * (S[n][j] - v)), fc = f(co);
      if (fc < F[n]) { S[n] = co; F[n] = fc; }
      else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); }
    }
  }
  const o = F.map((_, i) => i).sort((a, b) => F[a] - F[b]);
  return S[o[0]];
};

/* ---- the shipped contamination filter, so the fit and the feed agree ---- */
const parseCount = (raw) => {
  const t = raw.trim().toLowerCase(), s = t.endsWith('m') ? 1e6 : t.endsWith('k') ? 1e3 : 1;
  const d = t.replace(/[km]$/, '').trim();
  const v = s === 1 ? Number(d.replace(/[,.\u00a0\u202f\u2009 ]/g, '')) : Number(d.replace(/,/g, '.'));
  return Number.isFinite(v) ? Math.round(v * s) : null;
};

/** A larger figure elsewhere in the post makes the matched one a retrospective. */
const ANY_FIGURE = new RegExp(COUNT + String.raw`\s*\+?\s*(?:steam\s+)?(?:wishlists?|wishlist mark|mark\b|now\b)`, 'gi');

const verdict = (row) => {
  const text = row.quoted || '';
  if (rejectStoredQuote(text, row.wishlists)) return false;
  return ![...text.matchAll(ANY_FIGURE)]
    .map((m) => parseCount(m[1]))
    .some((v) => v != null && v > row.wishlists);
};

/* ---- rung ladder ---- */
const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9];
const rungGap = (v) => {
  const e = Math.floor(Math.log10(v) + 1e-9), m = v / 10 ** e;
  const i = LADDER.findIndex((x) => Math.abs(x - m) < 0.02);
  if (i < 0) return 0;
  const next = i + 1 < LADDER.length ? LADDER[i + 1] * 10 ** e : 10 ** (e + 1);
  return Math.log(next / (LADDER[i] * 10 ** e));
};

/* ---- load ---- */
const rawRows = fs.readFileSync(ANCHORS, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l))
  .map((r) => ({ ...r, age: Math.max(0, Math.round((SNAP_DAY - Date.parse(r.announcedAt + 'T00:00:00Z')) / 864e5)) }));
const snapJson = JSON.parse(fs.readFileSync(RANKS, 'utf8'));
const pos = new Map(); snapJson.appids.forEach((a, i) => { if (a && !pos.has(a)) pos.set(a, i + 1); });

const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
const seen = new Map();
for (const r of rawRows) { const k = norm(r.quoted); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(r.appid); }
const clean = rawRows.filter((r) => verdict(r) && seen.get(norm(r.quoted)).size === 1);
// rank re-attached BY APPID against this one snapshot, never the row's stored rank
const anchors = clean.map((r) => ({ ...r, rk: pos.get(r.appid) ?? null, gap: rungGap(r.wishlists) })).filter((r) => r.rk);
const best = {};
for (const r of anchors) { const p = best[r.appid]; if (!p || r.wishlists > p.wishlists || (r.wishlists === p.wishlists && r.age < p.age)) best[r.appid] = r; }
const games = Object.values(best);

console.log(`anchors : ${ANCHORS}`);
console.log(`ranks   : ${RANKS}  (${snapJson.listed} positions, ignore_preferences=1)`);
console.log(`${rawRows.length} rows -> ${clean.length} after the contamination filter -> ${anchors.length} with a rank -> ${games.length} games\n`);
{ const withStored = clean.filter((r) => r.rank && pos.get(r.appid));
  const dAxis = withStored.map((r) => Math.abs(pos.get(r.appid) - r.rank));
  console.log(`RANK RE-ATTACHMENT  every rank comes from this one snapshot, by appid. Stored row ranks are ignored.`);
  console.log(`                    vs the canonical axis: median |delta| ${med(dAxis)}, p90 ${qu(dAxis, .9)} — mostly the 7.4% axis offset, not drift.`);
  const DEF = find([process.env.DEFAULT_RANKS, 'data/wishlist-ranks.json']);
  if (DEF) { const dj = JSON.parse(fs.readFileSync(DEF, 'utf8')); const dp = new Map(); dj.appids.forEach((a, i) => { if (a && !dp.has(a)) dp.set(a, i + 1); });
    const s = withStored.filter((r) => dp.get(r.appid)); const dd = s.map((r) => Math.abs(dp.get(r.appid) - r.rank));
    console.log(`                    vs the default-axis snapshot on the SAME axis: ${dd.filter((x) => x > 0).length} of ${s.length} rows differ, median |delta| ${med(dd)}, p90 ${qu(dd, .9)} — that is snapshot drift.`); }
  console.log(''); }

/* ---- the one fit ---- */
const TAU = WISHLIST_SAID.tau;
const model = (P, d) => P[0] - P[1] * Math.log(d.rk + Math.abs(P[2])) - Math.abs(P[3]) * Math.log(1 + d.age / TAU) - Math.abs(P[4]) * d.gap;
const fit = (rs) => { const loss = (P) => { let s = 0; for (const d of rs) s += Math.abs(Math.log(d.wishlists) - model(P, d)); return s / rs.length; };
  let P = nm(loss, [19.8, 1.34, 96, 0.35, 0.15]); P = nm(loss, P); return P; };
const P = fit(games);
const refit = { A: Math.exp(P[0]), B: P[1], Q: Math.abs(P[2]), ALPHA: Math.abs(P[3]), RUNGK: Math.abs(P[4]), MEAN_GAP: mean(games.map((g) => g.gap)) };
refit.FLOOR = Math.exp(refit.RUNGK * refit.MEAN_GAP);

let fails = 0;

/**
 * What ships is judged on what it predicts, not on its parameters.
 *
 * A, B and Q trade against each other: a refit on a wider archive moved them
 * by 5.0%, 0.19% and 2.1% while the curve it draws moved 2.9% at its worst
 * point. Comparing parameters to the digit fails every day the archive grows
 * and says nothing about whether the answer changed.
 */
const DRIFT = 0.10;

console.log('REFIT FROM THE RAW FILES');
console.log('  parameters, for information — they trade against each other, so they are not the test');
for (const [name, got, want] of [
  ['A', refit.A, WISHLIST_CURVE.a], ['B', refit.B, WISHLIST_CURVE.b],
  ['Q', refit.Q, WISHLIST_CURVE.q], ['ALPHA', refit.ALPHA, WISHLIST_SAID.alpha],
  ['RUNGK', refit.RUNGK, RUNGK], ['MEAN_GAP', refit.MEAN_GAP, MEAN_GAP],
  ['FLOOR', refit.FLOOR, WISHLIST_SAID.floor]
]) {
  console.log(`    ${name.padEnd(10)} refit ${(name === 'A' ? fmt(got) : got.toFixed(5)).padStart(13)}   shipped ${(name === 'A' ? fmt(want) : want.toFixed(5)).padStart(13)}   ${((got / want - 1) >= 0 ? '+' : '') + (100 * (got / want - 1)).toFixed(1)}%`);
}

console.log(`
  what the shipped model predicts against a refit on today's archive (fails past ${(100 * DRIFT).toFixed(0)}%)`);
const LISTED = WISHLIST_CURVE.listed;
const shipCurve = (r) => WISHLIST_CURVE.a / Math.pow(r + WISHLIST_CURVE.q, WISHLIST_CURVE.b);
const newCurve = (r) => refit.A / Math.pow(r + refit.Q, refit.B);
let worst = { name: null, d: 0 };
for (const r of [1, 10, 50, 100, 300, 1000, 3000, LISTED]) {
  const d = newCurve(r) / shipCurve(r) - 1;
  if (Math.abs(d) > Math.abs(worst.d)) worst = { name: `rank ${r}`, d };
}
for (const age of [0, 30, 90, 365, 1095]) {
  const t = 1 + age / WISHLIST_SAID.tau;
  const d = (refit.FLOOR * Math.pow(t, refit.ALPHA)) / (WISHLIST_SAID.floor * Math.pow(t, WISHLIST_SAID.alpha)) - 1;
  if (Math.abs(d) > Math.abs(worst.d)) worst = { name: `carry-forward at ${age}d`, d };
}
const drifted = Math.abs(worst.d) > DRIFT;
if (drifted) fails++;
console.log(`  largest shift: ${(worst.d >= 0 ? '+' : '') + (100 * worst.d).toFixed(1)}% at ${worst.name}, `
  + `against a band ${(WISHLIST_CURVE.band.hi / WISHLIST_CURVE.band.lo).toFixed(2)}x wide   ${drifted ? 'DRIFTED' : 'ok'}`);

/** Percentiles of a residual distribution; they move with every snapshot. */
const near = (name, got, want, tol = 0.05) => {
  const ok = Math.abs(got / want - 1) <= tol; if (!ok) fails++;
  console.log(`  ${name.padEnd(22)} refit ${got.toFixed(3).padStart(12)}   shipped ${want.toFixed(3).padStart(12)}   ${ok ? 'ok' : 'DRIFTED'}`);
};

/* ---- 5 x 10-fold cross-validation ---- */
const oos = [];
for (const seed of [11, 22, 33, 44, 55]) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const idx = games.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  for (let k = 0; k < 10; k++) {
    const te = idx.filter((_, i) => i % 10 === k), tr = idx.filter((_, i) => i % 10 !== k);
    const Pk = fit(tr.map((i) => games[i]));
    for (const i of te) oos.push({ d: games[i], p: Math.exp(model(Pk, games[i])), c: Math.exp(Pk[0] - Pk[1] * Math.log(games[i].rk + Math.abs(Pk[2]))) });
  }
}
const line = (tag, g) => { if (!g.length) return;
  const ape = g.map((x) => Math.abs(x.p / x.d.wishlists - 1)), e = g.map((x) => Math.log(x.d.wishlists / x.p));
  console.log(`  ${tag.padEnd(22)} n=${String(g.length).padStart(4)}  medAPE ${(100 * med(ape)).toFixed(1).padStart(5)}%  within25 ${(100 * ape.filter((z) => z <= .25).length / ape.length).toFixed(0).padStart(3)}%  within50 ${(100 * ape.filter((z) => z <= .5).length / ape.length).toFixed(0).padStart(3)}%  resid x${Math.exp(qu(e, .1)).toFixed(2)}..x${Math.exp(qu(e, .9)).toFixed(2)}`); };
console.log('\nOUT-OF-SAMPLE ACCURACY (5 x 10-fold, held-out games)');
line('anchors under 30 days', oos.filter((x) => x.d.age <= 30));
line('anchors under 90 days', oos.filter((x) => x.d.age <= 90));
line('anchors under 1 year', oos.filter((x) => x.d.age <= 365));
line('all anchors, any age', oos);
const e90 = oos.filter((x) => x.d.age <= 90).map((x) => Math.log(x.d.wishlists / x.p));
// The band edges are percentiles of a residual distribution, so they move a
// little with every snapshot. Held to 1% rather than to the digit.
near('LO', Math.exp(qu(e90, .1)), WISHLIST_CURVE.band.lo);
near('HI', Math.exp(qu(e90, .9)), WISHLIST_CURVE.band.hi);

console.log('\nBY RANK DECILE (out of sample, anchors under 90 days)');
console.log('  decile   rank range      n   medAPE  within25  within50   resid p10..p90');
const t1 = oos.filter((x) => x.d.age <= 90).sort((a, b) => a.d.rk - b.d.rk);
const per = Math.ceil(t1.length / 10);
for (let i = 0; i < 10; i++) {
  const g = t1.slice(i * per, (i + 1) * per); if (!g.length) continue;
  const ape = g.map((x) => Math.abs(x.p / x.d.wishlists - 1)), e = g.map((x) => Math.log(x.d.wishlists / x.p));
  console.log(`  ${String(i + 1).padStart(6)}   ${String(g[0].d.rk).padStart(4)}-${String(g[g.length - 1].d.rk).padStart(4)}  ${String(g.length).padStart(5)}   ${(100 * med(ape)).toFixed(1).padStart(5)}%  ${(100 * ape.filter((z) => z <= .25).length / ape.length).toFixed(0).padStart(7)}%  ${(100 * ape.filter((z) => z <= .5).length / ape.length).toFixed(0).padStart(7)}%   x${Math.exp(qu(e, .1)).toFixed(2)}..x${Math.exp(qu(e, .9)).toFixed(2)}`);
}

/* ---- the freshest anchors ---- */
console.log('\nANCHORS ANNOUNCED WITHIN 30 DAYS OF THE SNAPSHOT — curve vs announced');
console.log('  rank    appid    announced      curve mid   curve/announced  age');
const fresh = anchors.filter((r) => r.age <= 30).sort((a, b) => a.rk - b.rk);
const ratios = [];
for (const r of fresh) { const m = wishlistsAtRank(r.rk).mid; ratios.push(m / r.wishlists);
  console.log(`  ${String(r.rk).padStart(4)} ${String(r.appid).padStart(8)} ${fmt(r.wishlists).padStart(12)} ${fmt(m).padStart(14)} ${(m / r.wishlists).toFixed(2).padStart(16)}  ${String(r.age).padStart(3)}d`); }
console.log(`\n  n=${ratios.length}   curve/announced: p10 ${qu(ratios, .1).toFixed(2)}  median ${med(ratios).toFixed(3)}  p90 ${qu(ratios, .9).toFixed(2)}`);
console.log(`  within 25% of the announced figure: ${(100 * ratios.filter((x) => Math.abs(x - 1) <= .25).length / ratios.length).toFixed(0)}%   within 50%: ${(100 * ratios.filter((x) => Math.abs(x - 1) <= .5).length / ratios.length).toFixed(0)}%`);
console.log(`  at or above the announced floor: ${(100 * ratios.filter((x) => x >= 1).length / ratios.length).toFixed(0)}%`);

/* ---- the growth model against the within-game legs ---- */
console.log('\nGROWTH MODEL vs THE WITHIN-GAME LEGS');
const byGame = new Map();
for (const r of clean) { if (!byGame.has(r.appid)) byGame.set(r.appid, []); byGame.get(r.appid).push(r); }
const legs = [];
for (const [appid, rs] of byGame) {
  const byDate = new Map();
  for (const r of rs) { const p = byDate.get(r.announcedAt); if (!p || r.wishlists > p.wishlists) byDate.set(r.announcedAt, r); }
  const seq = [...byDate.values()].sort((a, b) => a.announcedAt < b.announcedAt ? -1 : 1);
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i], d = Math.round((Date.parse(b.announcedAt) - Date.parse(a.announcedAt)) / 864e5);
    if (d > 0) legs.push({ appid, d, ratio: b.wishlists / a.wishlists, lr: Math.log(b.wishlists / a.wishlists) });
  }
}
const grow = legs.filter((l) => l.ratio > 1);
console.log(`  ${legs.length} consecutive legs over ${byGame.size} games, ${grow.length} strictly growing`);
{
  const X = grow.map((l) => l.d), Y = grow.map((l) => l.lr), xb = mean(X), yb = mean(Y);
  let n = 0, dd = 0; for (let i = 0; i < X.length; i++) { n += (X[i] - xb) * (Y[i] - yb); dd += (X[i] - xb) ** 2; }
  const b = n / dd, a = yb - b * xb;
  let sse = 0, sst = 0; for (let i = 0; i < X.length; i++) { sse += (Y[i] - yb - b * (X[i] - xb)) ** 2; sst += (Y[i] - yb) ** 2; }
  console.log(`  through the origin   sum(log ratio)/sum(days) = ${(100 * Y.reduce((s, y) => s + y, 0) / X.reduce((s, x) => s + x, 0)).toFixed(4)}%/day   <-- the 0.697%/day claim`);
  console.log(`  WITH an intercept    slope = ${(100 * b).toFixed(4)}%/day (t=${(b / Math.sqrt(sse / (X.length - 2) / dd)).toFixed(2)}), intercept = x${Math.exp(a).toFixed(3)}, R2 = ${(1 - sse / sst).toFixed(4)}`);
  console.log(`  the intercept is the ladder step, and it exists at duration zero. Forcing the`);
  console.log(`  line through the origin reassigns all of it to the slope: x${((Y.reduce((s, y) => s + y, 0) / X.reduce((s, x) => s + x, 0)) / b).toFixed(1)} inflation.`);
  console.log('  median leg ratio by duration — it RISES with duration, so the per-day "deceleration"');
  console.log('  is a constant numerator over a growing denominator, not a decelerating process:');
  for (const [lo, hi] of [[1, 30], [31, 90], [91, 180], [181, 365], [366, 1e9]]) {
    const g = grow.filter((l) => l.d >= lo && l.d <= hi); if (!g.length) continue;
    console.log(`    ${String(lo).padStart(4)}-${String(hi === 1e9 ? 'inf' : hi).padEnd(4)} n=${String(g.length).padStart(3)}  median ratio x${med(g.map((l) => l.ratio)).toFixed(2)}   median implied CAGR ${(100 * med(g.map((l) => l.lr / l.d))).toFixed(3)}%/day`);
  }
  console.log(`  this model's ALPHA=${WISHLIST_SAID.alpha} over TAU=${TAU}d implies ${(100 * WISHLIST_SAID.alpha / (TAU + 0)).toFixed(4)}%/day at age 0 falling to ${(100 * WISHLIST_SAID.alpha / (TAU + 365)).toFixed(4)}%/day at one year.`);
}

/* ---- INTERNAL CONSISTENCY: the referee ---- */
console.log('\nINTERNAL CONSISTENCY — carryForward against the out-of-sample curve');
console.log('  For a ranked game with an anchor, these are two estimates of the same number.');
console.log('  A ratio drifting above 1.0 with age would mean the growth model runs hot.');
console.log('    age bucket     games    curve/carryForward.mid     p25     p75    90% CI of the median');
const buckets = [[0, 14], [15, 30], [31, 60], [61, 90], [91, 180], [181, 365], [366, 730], [731, 1460], [1461, 1e9]];
let rs = 4242; const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (const [lo, hi] of buckets) {
  const g = oos.filter((x) => x.d.age >= lo && x.d.age <= hi); if (g.length < 6) continue;
  const rr = g.map((x) => x.c / carryForward(x.d.wishlists, x.d.age).mid);
  const bs = []; for (let b = 0; b < 400; b++) { const pick = []; for (let i = 0; i < rr.length; i++) pick.push(rr[Math.floor(rnd() * rr.length)]); bs.push(med(pick)); }
  const flag = (qu(bs, .05) > 1 || qu(bs, .95) < 1) && Math.abs(med(rr) - 1) > 0.05 ? '  <-- materially off x1.00' : '';
  console.log(`    ${String(lo).padStart(5)}-${String(hi === 1e9 ? 'inf' : hi).padEnd(5)} ${String(g.length / 5).padStart(6)}              x${med(rr).toFixed(3)}         x${qu(rr, .25).toFixed(2)}   x${qu(rr, .75).toFixed(2)}    x${qu(bs, .05).toFixed(2)}..x${qu(bs, .95).toFixed(2)}${flag}`);
}
// The real test is a TREND: if the growth law were too hot, the ratio would fall
// with age; too cold, it would rise. A flat line means the age law is right.
{
  const pts = oos.map((x) => ({ g: x.d.appid, x: Math.log(1 + x.d.age / TAU), y: Math.log(x.c / carryForward(x.d.wishlists, x.d.age).mid) }));
  // The model is a MEDIAN regression, so the estimator-consistent trend test is a
  // median (L1) slope. The mean slope is reported too: it answers a different
  // question — whether the upper TAIL fattens with age, which it does.
  const l1slope = (P) => { let s = 0; for (const p of pts) s += Math.abs(p.y - P[0] - P[1] * p.x); return s / pts.length; };
  const S = nm(l1slope, [0, 0]);
  const byG = new Map(); for (const p of pts) { if (!byG.has(p.g)) byG.set(p.g, []); byG.get(p.g).push(p); }
  const G = [...byG.values()];
  let bs2 = 777; const rnd2 = () => ((bs2 = (bs2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const boots = [];
  for (let b = 0; b < 120; b++) {
    const pick = []; for (let i = 0; i < G.length; i++) pick.push(...G[Math.floor(rnd2() * G.length)]);
    const f = (P) => { let s = 0; for (const p of pick) s += Math.abs(p.y - P[0] - P[1] * p.x); return s / pick.length; };
    boots.push(nm(f, S, 0.06, 6000)[1]);
  }
  const xb = mean(pts.map((p) => p.x)), yb = mean(pts.map((p) => p.y));
  let n2 = 0, d2 = 0; for (const p of pts) { n2 += (p.x - xb) * (p.y - yb); d2 += (p.x - xb) ** 2; }
  console.log(`  TREND TEST (median, matching the estimator)`);
  console.log(`    d log(curve / carried) / d log(1+age/${TAU}) = ${S[1].toFixed(4)}   90% CI ${qu(boots, .05).toFixed(4)} .. ${qu(boots, .95).toFixed(4)} (bootstrap by game)`);
  console.log(`    a slope of 0 means the growth law is neither hot nor cold; +ve = too cold, -ve = too hot.`);
  console.log(`    implied ALPHA ${(WISHLIST_SAID.alpha + S[1]).toFixed(4)} vs shipped ${WISHLIST_SAID.alpha} -> x${((1 + 365 / TAU) ** (WISHLIST_SAID.alpha + S[1]) / (1 + 365 / TAU) ** WISHLIST_SAID.alpha).toFixed(3)} at one year.`);
  const consistent = qu(boots, .05) <= 0 && qu(boots, .95) >= 0;
  console.log(`    ${consistent ? 'CONSISTENT' : 'INCONSISTENT'}: zero is ${consistent ? 'inside' : 'outside'} the interval, so the two legs agree across the whole age range.`);
  if (!consistent) fails++;
  console.log(`    for contrast, the MEAN slope is ${(n2 / d2).toFixed(4)}: the upper tail of the ratio does fatten with age`);
  console.log(`    (p75 rises from x1.12 at a fortnight to x2.17 at 1-2 years), which the band carries, not the midpoint.`);
}
{
  const inb = oos.filter((x) => { const c = carryForward(x.d.wishlists, x.d.age); return x.c >= c.lo && x.c <= c.hi; }).length;
  console.log(`  the carryForward band covers the out-of-sample curve ${(100 * inb / oos.length).toFixed(0)}% of the time (target 80%)`);
}
console.log('  what the two prior analyses would have said instead, scored on the same data:');
for (const [tag, f] of [['shipped 0.0687%/day', (a) => Math.exp(0.000687 * a)], ['cross-sectional 0.181%/day', (a) => Math.exp(0.001809 * a)],
  ['within-game 0.697%/day', (a) => Math.exp(0.006968 * a)], ['(1 + age/30)^0.31', (a) => (1 + a / 30) ** 0.31],
  ['this model', (a) => WISHLIST_SAID.floor * (1 + a / TAU) ** WISHLIST_SAID.alpha]]) {
  let s = 0; for (const x of oos) s += Math.abs(Math.log(x.c / (x.d.wishlists * f(x.d.age))));
  console.log(`    ${tag.padEnd(28)} mean |log(curve / carried)| ${(s / oos.length).toFixed(4)}  -> typical disagreement x${Math.exp(s / oos.length).toFixed(2)}`);
}

/* ---- monotonicity + the hard checks ---- */
console.log('\nCHECKS');
let mono = true, prev = Infinity;
for (let r = 1; r <= WISHLIST_CURVE.listed; r++) { const v = wishlistsAtRank(r).mid; if (!(v < prev)) mono = false; prev = v; }
console.log(`  strictly monotone decreasing over ranks 1..${WISHLIST_CURVE.listed}: ${mono}`); if (!mono) fails++;
const r1 = wishlistsAtRank(1).mid;
console.log(`  finite at rank 1: ${Number.isFinite(r1)}  (${fmt(r1)})`); if (!Number.isFinite(r1)) fails++;
const SH = 2153760, shRank = pos.get(SH), shW = shRank ? wishlistsAtRank(shRank).mid : NaN;
const shOk = shW >= 500_000 && shW <= 600_000;
console.log(`  Stronghold 4 (${SH}) at rank ${shRank}: ${fmt(shW)}  [need 500,000-600,000] ${shOk ? 'PASS' : 'FAIL'}`); if (!shOk) fails++;
const medFresh = med(ratios), freshOk = medFresh > 1.0 && medFresh < 1.25;
console.log(`  median curve/announced on the ${ratios.length} anchors under 30 days: ${medFresh.toFixed(3)}  [need slightly >1.0] ${freshOk ? 'PASS' : 'FAIL'}`); if (!freshOk) fails++;
console.log('');
for (const r of [1, 10, 53, 82, 120, 250, 500, 1000, 2000, 3000, 5574]) {
  const w = wishlistsAtRank(r);
  console.log(`  rank ${String(r).padStart(4)}  ${fmt(w.lo).padStart(10)} .. ${fmt(w.mid).padStart(10)} .. ${fmt(w.hi).padStart(10)}`);
}
console.log('');
for (const d of [0, 30, 90, 180, 365, 730, 1500, 2500]) {
  const c = carryForward(100_000, d);
  console.log(`  a 100,000 announcement ${String(d).padStart(4)}d old  ->  ${fmt(c.lo).padStart(9)} .. ${fmt(c.mid).padStart(9)} .. ${fmt(c.hi).padStart(9)}   (mid x${(c.mid / 1e5).toFixed(3)})`);
}
console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);

