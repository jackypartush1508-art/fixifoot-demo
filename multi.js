// Fixifoot v8 – 2-material print files: every v7 model is split into TWO scan-fitted bodies that fit together exactly.
// Same 2D-profile approach as openings.js (no CSG): the sole is re-meshed once in its (ui = length, sn = across) parameter
// space (tile grid + openings/inserts with zipper rings). Each body is a set of those 2D triangles with its own lower/upper
// height function. Both bodies use the SAME vertices on the shared interface (layer surface or insert walls), so the
// interface is identical in both files: no gap, no overlap. Every body is a closed, consistently oriented mesh.
import * as THREE from 'three';
import { OPENING_PRESETS, MIN_WALL } from './openings.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const d2seg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };

/* ---------- 1. one shared 2D plan ---------- */
// S(ui, sn) -> { x, l, tz, bz, u }.  o = { mode: 'holes'|'lattice'|null, density, d, allow(u, sn), rimMargin, extras: [{ id, u, sn, ru (mm), rs (mm), n }] }
export function planSplit(S, o = {}) {
  const mode = o.mode || null, pr = mode ? { ...(OPENING_PRESETS[mode][o.density] || OPENING_PRESETS[mode].med) } : { pitch: 8 };
  if (mode === 'holes' && o.d) { pr.d = clamp(+o.d, 2, 5); pr.pitch = Math.max(pr.pitch, pr.d + 2.2); }
  const wall = Math.max(MIN_WALL, mode === 'lattice' ? pr.wall : (o.wall ?? 1.6)), rim = o.rimMargin ?? (mode === 'lattice' ? 7 : 5);
  const allow = o.allow || (() => true);
  const Lphys = Math.abs(S(1, 0).l - S(0, 0).l);
  const hwAt = ui => Math.hypot(S(ui, 1).x - S(ui, -1).x, S(ui, 1).l - S(ui, -1).l) / 2;
  let hwRef = 0; for (let k = 0; k <= 60; k++) hwRef = Math.max(hwRef, hwAt(k / 60));
  let Tu, Ts; if (mode === 'lattice') { Ts = pr.cell; Tu = 2 * (pr.cell - wall) / Math.sqrt(3) + wall; } else { Tu = Ts = pr.pitch; }
  const mu = 4, ms = 4, pu = Tu / Lphys, ps = Ts / hwRef;
  const uaMin = (rim + 1) / Lphys, nTu = Math.max(0, Math.floor((1 - 2 * uaMin) / pu)), ua = (1 - nTu * pu) / 2;
  const nEnd = Math.max(6, Math.ceil(ua * Lphys / 1.6)), U = [];
  for (let k = 0; k < nEnd; k++) U.push(ua * (1 - Math.cos(k / nEnd * Math.PI / 2)));
  for (let k = 0; k <= nTu * mu; k++) U.push(ua + k * pu / mu);
  for (let k = nEnd - 1; k >= 0; k--) U.push(1 - ua * (1 - Math.cos(k / nEnd * Math.PI / 2)));
  const eS = Math.min(.6, (rim * .6) / hwRef), nTs = Math.max(0, Math.floor((2 - 2 * eS) / ps)), sa = -nTs * ps / 2, nE = 6, SN = [];
  for (let k = 0; k < nE; k++) SN.push(-1 + (sa + 1) * (1 - Math.cos(k / nE * Math.PI / 2)));
  for (let k = 0; k <= nTs * ms; k++) SN.push(sa + k * ps / ms);
  for (let k = nE - 1; k >= 0; k--) SN.push(1 - (sa + 1) * (1 - Math.cos(k / nE * Math.PI / 2)));
  const NUl = U.length, NSl = SN.length, V = [];
  for (let i = 0; i < NUl; i++) for (let j = 0; j < NSl; j++) V.push({ ui: U[i], sn: SN[j], ...S(U[i], SN[j]) });
  const gid = (i, j) => i * NSl + j;
  const outl = []; for (let i = 0; i < NUl; i++) outl.push([V[gid(i, 0)].x, V[gid(i, 0)].l]); for (let j = 1; j < NSl; j++) outl.push([V[gid(NUl - 1, j)].x, V[gid(NUl - 1, j)].l]);
  for (let i = NUl - 2; i >= 0; i--) outl.push([V[gid(i, NSl - 1)].x, V[gid(i, NSl - 1)].l]); for (let j = NSl - 2; j > 0; j--) outl.push([V[gid(0, j)].x, V[gid(0, j)].l]);
  const rimDist = (x, l) => { let m = Infinity; for (let k = 0; k < outl.length; k++) { const a = outl[k], b = outl[(k + 1) % outl.length]; m = Math.min(m, d2seg(x, l, a[0], a[1], b[0], b[1])); } return m; };
  const covered = new Int32Array((NUl - 1) * (NSl - 1)).fill(-1), feats = [];
  const blockBorder = (i0, i1, j0, j1) => { const b = []; for (let i = i0; i < i1; i++) b.push(gid(i, j0)); for (let j = j0; j < j1; j++) b.push(gid(i1, j)); for (let i = i1; i > i0; i--) b.push(gid(i, j1)); for (let j = j1; j > j0; j--) b.push(gid(i0, j)); return b; };
  const free = (i0, i1, j0, j1) => { for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (covered[i * (NSl - 1) + j] >= 0) return false; return true; };
  const claim = (i0, i1, j0, j1, k) => { for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) covered[i * (NSl - 1) + j] = k; };
  // (a) large inserts (ellipses given in foot-u / sn / mm) – placed first
  const uiOfU = u => { let a = 0, b = 1; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (S(m, 0).u < u) a = m; else b = m; } return (a + b) / 2; };
  for (const e of o.extras || []) {
    const cu = uiOfU(e.u), du = e.ru / Lphys, ds = e.rsn != null ? e.rsn : e.rs / Math.max(hwAt(cu), 1), n = e.n || 28;
    const pts = []; for (let k = 0; k < n; k++) { const th = 2 * Math.PI * k / n; pts.push([cu + du * Math.cos(th), clamp(e.sn + ds * Math.sin(th), -.97, .97)]); }
    const uiMin = Math.min(...pts.map(p => p[0])), uiMax = Math.max(...pts.map(p => p[0])), snMin = Math.min(...pts.map(p => p[1])), snMax = Math.max(...pts.map(p => p[1]));
    let i0 = 0; while (i0 + 1 < NUl && U[i0 + 1] < uiMin - .4 / Lphys) i0++; let i1 = NUl - 1; while (i1 - 1 > 0 && U[i1 - 1] > uiMax + .4 / Lphys) i1--;
    let j0 = 0; while (j0 + 1 < NSl && SN[j0 + 1] < snMin - .01) j0++; let j1 = NSl - 1; while (j1 - 1 > 0 && SN[j1 - 1] > snMax + .01) j1--;
    if (!free(i0, i1, j0, j1)) continue;
    const ph = pts.map(([a, b]) => ({ ui: a, sn: b, ...S(a, b) }));
    let dR = Infinity; for (const q of ph) dR = Math.min(dR, rimDist(q.x, q.l));
    if (dR < (e.minRim ?? 2.5)) continue;
    feats.push({ kind: 'insert', id: e.id, label: e.label, ph, border: blockBorder(i0, i1, j0, j1), cu, cs: e.sn, dR }); claim(i0, i1, j0, j1, feats.length - 1);
  }
  // (b) tile openings (round holes / hexagonal windows) – same rules as openings.js
  let tiles = 0;
  if (mode) for (let r = 0; r < nTu; r++) {
    const i0 = nEnd + r * mu, shift = (r % 2) * (ms / 2);
    for (let c = 0; ; c++) {
      const j0 = nE + shift + c * ms; if (j0 + ms > nE + nTs * ms) break;
      if (!free(i0, i0 + mu, j0, j0 + ms)) continue;
      const u0 = U[i0], u1 = U[i0 + mu], s0 = SN[j0], s1 = SN[j0 + ms], uc = (u0 + u1) / 2, sc = (s0 + s1) / 2, cen = S(uc, sc);
      if (!allow(cen.u, sc)) continue;
      const pA = S(u0, sc), pB = S(u1, sc), pC = S(uc, s0), pD = S(uc, s1);
      const Lu = Math.hypot(pB.x - pA.x, pB.l - pA.l), Ls = Math.hypot(pD.x - pC.x, pD.l - pC.l);
      let n, rad, minScale;
      if (mode === 'holes') { n = 12; rad = pr.d / 2; minScale = .86; if (Math.min(Lu, Ls) < pr.d + wall) continue; }
      else { n = 6; rad = Math.min((Ls - wall) / Math.sqrt(3), (Lu - wall) / 2); minScale = 1.8 / Math.max(rad, 1e-6); if (rad < 1.8) continue; }
      const border = blockBorder(i0, i0 + mu, j0, j0 + ms); let ok = null;
      for (const sc2 of [1, .94, .88, .82, .76, .7]) {
        if (sc2 < minScale) break;
        const ph = []; for (let k = 0; k < n; k++) { const th = 2 * Math.PI * k / n + (mode === 'holes' ? Math.PI / n : 0); const a = uc + rad * sc2 * Math.cos(th) / Lu * (u1 - u0), b = sc + rad * sc2 * Math.sin(th) / Ls * (s1 - s0); ph.push({ ui: a, sn: b, ...S(a, b) }); }
        let dB = Infinity, dR = Infinity;
        for (const q of ph) { for (let k = 0; k < border.length; k++) { const A = V[border[k]], B = V[border[(k + 1) % border.length]]; dB = Math.min(dB, d2seg(q.x, q.l, A.x, A.l, B.x, B.l)); } dR = Math.min(dR, rimDist(q.x, q.l)); }
        if (dB >= wall / 2 - 1e-6 && dR >= rim) { ok = { ph, border, dB, dR }; break; }
        if (dR < rim * .5) break;
      }
      if (!ok) continue;
      feats.push({ kind: mode === 'holes' ? 'hole' : 'cell', ...ok, cu: uc, cs: sc, r, c }); claim(i0, i0 + mu, j0, j0 + ms, feats.length - 1); tiles++;
    }
  }
  // ---------- 2D triangles (tagged) ----------
  const VV = V.slice(), tris = []; // { a, b, c, t: 'c'|'r'|'i', i, j, f }
  const push = (a, b, c, tag) => { const A = VV[a], B = VV[b], C = VV[c], s = (B.ui - A.ui) * (C.sn - A.sn) - (C.ui - A.ui) * (B.sn - A.sn); tris.push(s >= 0 ? { a, b, c, ...tag } : { a, b: c, c: b, ...tag }); };
  for (let i = 0; i < NUl - 1; i++) for (let j = 0; j < NSl - 1; j++) if (covered[i * (NSl - 1) + j] < 0) {
    const a = gid(i, j), b = gid(i + 1, j), c = gid(i + 1, j + 1), d = gid(i, j + 1), tag = { t: 'c', i, j, cu: (U[i] + U[i + 1]) / 2, cs: (SN[j] + SN[j + 1]) / 2 }; push(a, b, c, tag); push(a, c, d, tag);
  }
  feats.forEach((f, k) => {
    const ku = Lphys, ks = hwAt(f.cu), ang = v => Math.atan2((v.sn - f.cs) * ks, (v.ui - f.cu) * ku);
    const inner = f.ph.map(p => { VV.push(p); return VV.length - 1; });
    const sortLoop = ids => { const a = ids.map(id => [id, ang(VV[id])]); let m = 0; for (let q = 1; q < a.length; q++) if (a[q][1] < a[m][1]) m = q; const out = a.slice(m).concat(a.slice(0, m)); let prev = -Infinity; for (const e of out) { while (e[1] < prev) e[1] += 2 * Math.PI; prev = e[1]; } return out; };
    const O = sortLoop(f.border), I = sortLoop(inner); O.push([O[0][0], O[0][1] + 2 * Math.PI]); I.push([I[0][0], I[0][1] + 2 * Math.PI]);
    let p = 0, q = 0;
    while (p < O.length - 1 || q < I.length - 1) {
      const advO = q >= I.length - 1 || (p < O.length - 1 && O[p + 1][1] <= I[q + 1][1]);
      if (advO) { push(O[p][0], O[p + 1][0], I[q][0], { t: 'r', f: k }); p++; } else { push(O[p][0], I[q + 1][0], I[q][0], { t: 'r', f: k }); q++; }
    }
    // interior: concentric rings + centre fan (gives interior height samples for inserts / layer caps)
    const nR = f.kind === 'insert' ? 4 : 2, rings = [inner];
    for (let r = 1; r < nR; r++) { const sc = 1 - r / nR; rings.push(f.ph.map(pp => { const a = f.cu + (pp.ui - f.cu) * sc, b = f.cs + (pp.sn - f.cs) * sc; VV.push({ ui: a, sn: b, ...S(a, b) }); return VV.length - 1; })); }
    VV.push({ ui: f.cu, sn: f.cs, ...S(f.cu, f.cs) }); const cIdx = VV.length - 1, n = inner.length;
    for (let r = 0; r < rings.length - 1; r++) for (let m = 0; m < n; m++) { const a = rings[r][m], b = rings[r][(m + 1) % n], c = rings[r + 1][(m + 1) % n], d = rings[r + 1][m]; push(a, b, c, { t: 'i', f: k }); push(a, c, d, { t: 'i', f: k }); }
    const last = rings[rings.length - 1]; for (let m = 0; m < n; m++) push(last[m], last[(m + 1) % n], cIdx, { t: 'i', f: k });
  });
  return { VV, tris, feats, U, SN, NUl, NSl, Lphys, hwRef, wall, rim, mode, preset: pr, tiles };
}

/* ---------- 2. one closed body from a subset of the plan ---------- */
export function bodyGeometry(plan, include, zlo, zhi) {
  const { VV, tris } = plan, sel = tris.filter(include), used = new Map(), pos = [], idx = [];
  const vid = (k, top) => { const key = k * 2 + (top ? 1 : 0); let v = used.get(key); if (v == null) { const p = VV[k]; v = pos.length / 3; pos.push(p.x, top ? zhi(p) : zlo(p), p.l); used.set(key, v); } return v; };
  const edges = new Map(), EK = (a, b) => a * 1048576 + b;
  for (const t of sel) { idx.push(vid(t.a, 1), vid(t.b, 1), vid(t.c, 1)); idx.push(vid(t.a, 0), vid(t.c, 0), vid(t.b, 0)); for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) edges.set(EK(a, b), [a, b]); }
  let minT = Infinity;
  for (const [, [a, b]] of edges) if (!edges.has(EK(b, a))) { const ta = vid(a, 1), tb = vid(b, 1), ba = vid(a, 0), bb = vid(b, 0); idx.push(tb, ta, ba, tb, ba, bb); }
  for (const [key] of used) if (key % 2) { const p = VV[(key - 1) / 2]; minT = Math.min(minT, zhi(p) - zlo(p)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { geometry: g, minThickness: minT, triangles: idx.length / 3 };
}

/* ---------- 3. the six v8 recipes ---------- */
// dual = product.dual (rules.js); ctx = { ballU, L, holes: {mode,density,d} | null, allowHoles, pos: { met, hallux, pad, arch } }
export function buildTwoMaterial(rows, lenKey, dual, ctx) {
  const N = rows.length, M = rows[0].length, uis = rows.map(r => r[0].ui);
  const S = (ui, sn) => { // bilinear (same as openings.rowSampler)
    ui = clamp(ui, uis[0], uis[N - 1]); let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (uis[m] <= ui) lo = m; else hi = m; }
    const fu = (ui - uis[lo]) / ((uis[hi] - uis[lo]) || 1), fj = clamp((sn + 1) / 2 * (M - 1), 0, M - 1), j0 = Math.min(M - 2, Math.floor(fj)), fv = fj - j0;
    const a = rows[lo][j0], b = rows[lo][j0 + 1], c = rows[hi][j0], d = rows[hi][j0 + 1], Lk = k => (a[k] * (1 - fv) + b[k] * fv) * (1 - fu) + (c[k] * (1 - fv) + d[k] * fv) * fu;
    return { x: Lk('x'), l: Lk(lenKey), tz: Lk('tz'), bz: Lk('bz'), u: Lk('u') };
  };
  const type = dual.type, P = ctx.pos;
  let planOpts = {};
  if (dual.id === 'sport') planOpts = { mode: 'lattice', density: 'high', rimMargin: 7.5, allow: (u) => u > .03 && u < .27 };
  else if (dual.id === 'everyday' && ctx.holes) planOpts = { mode: 'holes', density: ctx.holes.density, d: ctx.holes.d, allow: ctx.allowHoles };
  else if (dual.id === 'work') planOpts = { mode: 'lattice', density: 'med', rimMargin: 6, allow: (u, sn) => (u > .06 && u < .25) || (u > ctx.ballU - .07 && u < ctx.ballU + .1 && Math.abs(sn) < .75) };
  else if (dual.id === 'diabetic') planOpts = { extras: [{ id: 'met', label: 'Extra-soft insert – metatarsal heads', ...P.met }, { id: 'hallux', label: 'Extra-soft insert – hallux', ...P.hallux }, { id: 'arch', label: 'Soft medial arch band', ...P.arch }] };
  else if (dual.id === 'dress') planOpts = { extras: [{ id: 'pad', label: 'Soft metatarsal pad', ...P.pad, minRim: 2 }] };
  if (ctx.label && planOpts.allow) { const a = planOpts.allow, lb = ctx.label; planOpts.allow = (u, sn) => a(u, sn) && !(Math.abs(u - lb.u) < lb.du && Math.abs(sn) < lb.sn); } // v9: solid under the initials
  const plan = planSplit(S, planOpts);
  // layer split: the top layer keeps topT measured PERPENDICULAR to the surface (slope-compensated, so the heel-cup walls stay
  // >= topT thick), the base keeps >= 1.2 mm; where the whole sole is < 2.4 mm (feathered toe tip only) it is split 50/50.
  const top = dual.topT || 1.4, hU = .004, hS = .02;
  const slopeF = p => { const a = S(p.ui + hU, p.sn), b = S(p.ui - hU, p.sn), c = S(p.ui, p.sn + hS), d = S(p.ui, p.sn - hS);
    const xu = a.x - b.x, lu = a.l - b.l, tu = a.tz - b.tz, xs = c.x - d.x, ls = c.l - d.l, ts = c.tz - d.tz, det = xu * ls - xs * lu;
    if (Math.abs(det) < 1e-9) return 1; const gx = (tu * ls - ts * lu) / det, gl = (xu * ts - xs * tu) / det; return Math.min(2.2, Math.sqrt(1 + gx * gx + gl * gl)); };
  const lzCache = new Map();
  const layerZ = p => { const key = p.ui.toFixed(6) + ',' + p.sn.toFixed(6); let z = lzCache.get(key); if (z !== undefined) return z;
    const T = p.tz - p.bz, t = top * slopeF(p); z = p.tz - (T >= t + 1.2 ? t : T >= 2.4 ? T - 1.2 : T / 2); lzCache.set(key, z); return z; };
  // Sport: open "windows" in the side wall of the black base under the heel (vertical slots, bridged by the blue top layer)
  const notch = t => { // 2-of-3 cells open along the heel side wall, depth = rim zone + 1 sub-cell (~4.5 mm); lattice keeps >= 7 mm from the edge
    if (dual.id !== 'sport' || t.t !== 'c') return false; const NS = plan.NSl - 1, nN = 7; if (!(t.j < nN || t.j >= NS - nN)) return false;
    const uu = S(t.cu, t.cs).u; return uu > .05 && uu < .28 && t.i % 3 < 2; };
  const isHole = t => (t.t === 'i' && plan.feats[t.f].kind === 'hole');
  let A, B;
  if (type === 'layer') { // base [bz, layer], top layer [layer, tz]; holes through both; Sport: lattice + side windows in the base only
    A = bodyGeometry(plan, t => !isHole(t) && !(t.t === 'i' && plan.feats[t.f].kind === 'cell') && !notch(t), p => p.bz, layerZ);
    B = bodyGeometry(plan, t => !isHole(t), layerZ, p => p.tz);
  } else { // insert type: shell = everything except the insert/window interiors; inserts = interiors, full height (flush with the top)
    A = bodyGeometry(plan, t => t.t !== 'i', p => p.bz, p => p.tz);
    B = bodyGeometry(plan, t => t.t === 'i', p => p.bz, p => p.tz);
  }
  const feats = plan.feats;
  const stats = { recipe: type, tilesMode: plan.mode, openings: feats.filter(f => f.kind !== 'insert').length, inserts: feats.filter(f => f.kind === 'insert').map(f => ({ id: f.id, label: f.label, rimMm: +f.dR.toFixed(1) })),
    wallBetweenOpeningsTargetMm: plan.mode ? plan.wall : null, minRimMm: feats.length ? +Math.min(...feats.map(f => f.dR)).toFixed(2) : null,
    minThicknessMm: { [dual.bodies[0].id]: +A.minThickness.toFixed(2), [dual.bodies[1].id]: +B.minThickness.toFixed(2) }, triangles: A.triangles + B.triangles };
  return { bodies: [{ ...dual.bodies[0], geometry: A.geometry }, { ...dual.bodies[1], geometry: B.geometry }], stats, plan };
}

/* ---------- 4. print frame (Z-up, bottom on Z=0, outward normals) – one transform for both bodies ---------- */
export function bodiesToPrint(bodies) {
  const gs = bodies.map(b => { const g = b.geometry.clone(); g.rotateX(Math.PI / 2); return g; });
  const bb = new THREE.Box3(); gs.forEach(g => { g.computeBoundingBox(); bb.union(g.boundingBox); });
  const off = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  return bodies.map((b, k) => {
    const g = gs[k]; g.translate(off.x, off.y, off.z);
    const P = g.attributes.position, I = g.index.array; let vol = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < I.length; i += 3) { a.fromBufferAttribute(P, I[i]); b2.fromBufferAttribute(P, I[i + 1]); c.fromBufferAttribute(P, I[i + 2]); vol += a.dot(b2.cross(c)) / 6; }
    if (vol < 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } vol = -vol; }
    g.computeVertexNormals(); return { ...b, geometry: g, volumeMm3: Math.round(vol) };
  });
}

/* ---------- 5. 3MF writer (core spec + Orca/Bambu + PrusaSlicer part/extruder metadata) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipStore(files) { // [{ name, data: Uint8Array|string }] -> Uint8Array (stored, no compression)
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const cenSize = cen.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cenSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; } return out;
}
const xe = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function build3MF(bodies, meta = {}) { // bodies in print frame: [{ id, name, material, color, extruder, geometry }]
  const f = v => (Math.round(v * 1000) / 1000).toString();
  const mats = bodies.map(b => `<base name="${xe(b.material + ' – ' + b.colorName)}" displaycolor="${b.color.toUpperCase()}FF" />`).join('');
  const objs = bodies.map((b, k) => {
    const P = b.geometry.attributes.position, I = b.geometry.index.array; const vs = [], ts = [];
    for (let i = 0; i < P.count; i++) vs.push(`<vertex x="${f(P.getX(i))}" y="${f(P.getY(i))}" z="${f(P.getZ(i))}"/>`);
    for (let i = 0; i < I.length; i += 3) ts.push(`<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}"/>`);
    return `<object id="${k + 2}" type="model" name="${xe(b.name)}" pid="1" pindex="${k}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`;
  }).join('\n');
  const asm = bodies.length + 2;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:fixifoot="http://fixifoot.ph/3mf/2026">
<metadata name="Title">${xe(meta.title || 'Fixifoot insole')}</metadata><metadata name="Designer">Fixifoot Philippines</metadata><metadata name="Application">Fixifoot demo v9</metadata>
<metadata name="Description">${xe(meta.description || '')}</metadata><metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>
<metadata name="fixifoot:printSettings">${xe(JSON.stringify(meta.print || {}))}</metadata>
<resources><basematerials id="1">${mats}</basematerials>
${objs}
<object id="${asm}" type="model" name="${xe(meta.title || 'Fixifoot insole')}"><components>${bodies.map((b, k) => `<component objectid="${k + 2}"/>`).join('')}</components></object>
</resources><build><item objectid="${asm}"/></build></model>`;
  // Orca / Bambu Studio: parts of one object, extruder per part
  const orca = `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="${asm}"><metadata key="name" value="${xe(meta.title || 'Fixifoot insole')}"/><metadata key="extruder" value="1"/>
${bodies.map((b, k) => `<part id="${k + 2}" subtype="normal_part"><metadata key="name" value="${xe(b.name)}"/><metadata key="extruder" value="${b.extruder}"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/></part>`).join('\n')}
</object></config>`;
  // PrusaSlicer: volumes = triangle ranges of the merged object (we keep separate objects, so map per object)
  let tri0 = 0; const vols = bodies.map(b => { const n = b.geometry.index.count / 3, v = `<volume firstid="${tri0}" lastid="${tri0 + n - 1}"><metadata type="volume" key="name" value="${xe(b.name)}"/><metadata type="volume" key="extruder" value="${b.extruder}"/></volume>`; tri0 += n; return v; });
  const prusa = `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="${asm}" instances_count="1"><metadata type="object" key="name" value="${xe(meta.title || 'Fixifoot insole')}"/>${vols.join('')}</object></config>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/><Default Extension="json" ContentType="application/json"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/model_settings.config', data: orca },
    { name: 'Metadata/Slic3r_PE_model.config', data: prusa },
    { name: 'Metadata/fixifoot_print_settings.json', data: JSON.stringify({ ...meta.print, bodies: bodies.map(b => ({ name: b.name, material: b.material, color: b.color, colorName: b.colorName, extruder: b.extruder, volumeCm3: +(b.volumeMm3 / 1000).toFixed(1) })) }, null, 2) },
  ];
  return zipStore(files);
}
