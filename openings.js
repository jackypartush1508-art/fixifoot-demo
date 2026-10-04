// Fixifoot v6 – REAL ventilation holes (perforated insole) and lattice openings (slide) as printable geometry.
// 2D-profile approach (no CSG): the sole is re-meshed on a tile grid in its (ui = length, sn = across) parameter
// space; tiles that receive an opening are re-triangulated (zipper between the tile border and the opening
// polygon) and the opening gets a vertical wall from top to bottom. Every edge is shared by exactly two faces
// -> closed, consistently oriented (watertight) mesh. Same geometry is used for the 3D preview and the STL.
import * as THREE from 'three';

export const MIN_WALL = 1.2; // 3 perimeters with a 0.4 mm nozzle (TPU)
export const HOLE_DIAMETERS = [3, 3.5, 4];
export const OPENING_PRESETS = {
  holes:   { low: { d: 3.5, pitch: 9.0, label: 'Low – 9 mm spacing' }, med: { d: 3.5, pitch: 7.5, label: 'Medium – 7.5 mm spacing' }, high: { d: 3.5, pitch: 6.2, label: 'High – 6.2 mm spacing' } },
  lattice: { low: { cell: 12, wall: 2.4, label: 'Low – 12 mm cells, 2.4 mm walls' }, med: { cell: 9.5, wall: 2.0, label: 'Medium – 9.5 mm cells, 2.0 mm walls' }, high: { cell: 7.5, wall: 1.6, label: 'High – 7.5 mm cells, 1.6 mm walls' } },
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// bilinear sampler over a sole's row grid: rows[i][j] = { ui, sn, x, <lenKey>, tz, bz, u }, sn uniform in j
export function rowSampler(rows, lenKey) {
  const NU = rows.length, NV = rows[0].length, uis = rows.map(r => r[0].ui);
  return (ui, sn) => {
    ui = clamp(ui, uis[0], uis[NU - 1]);
    let lo = 0, hi = NU - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (uis[m] <= ui) lo = m; else hi = m; }
    const fu = (ui - uis[lo]) / ((uis[hi] - uis[lo]) || 1);
    const fj = clamp((sn + 1) / 2 * (NV - 1), 0, NV - 1), j0 = Math.min(NV - 2, Math.floor(fj)), fv = fj - j0;
    const a = rows[lo][j0], b = rows[lo][j0 + 1], c = rows[hi][j0], d = rows[hi][j0 + 1];
    const L = k => (a[k] * (1 - fv) + b[k] * fv) * (1 - fu) + (c[k] * (1 - fv) + d[k] * fv) * fu;
    return { x: L('x'), l: L(lenKey), tz: L('tz'), bz: L('bz'), u: L('u') };
  };
}

// where openings are allowed (u = foot length fraction from the heel, sn = +1 medial / -1 lateral)
export function defaultAllow(mode, p = {}, ballU = .7) {
  if (mode === 'holes') return (u, sn) => {
    if (u < .25) return false;                 // heel cup – keep solid
    if (u < .62 && sn > -.45) return false;    // medial longitudinal arch support / midfoot shell
    if (u > .93) return false;                 // thin toe end
    if (p.metPad && Math.hypot((u - (ballU - .06)) / .07, (sn - .05) / .5) < 1) return false; // metatarsal pad dome
    return true;
  };
  return (u, sn) => !(u > .36 && u < .86 && Math.abs(sn) > .5); // slide: solid strap-anchor areas along both edges
}

const d2seg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const polyDist = (A, B) => { let m = Infinity; for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let k = 0; k < Q.length; k++) { const q = Q[k], r = Q[(k + 1) % Q.length]; m = Math.min(m, d2seg(p[0], p[1], q[0], q[1], r[0], r[1])); } return m; };
const area2 = P => { let s = 0; for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };

/**
 * S(ui, sn) -> { x, l, tz, bz, u }  (three.js frame: position = (x, tz|bz, l))
 * o = { mode: 'holes'|'lattice', density, allow(u, sn), rimMargin (mm), colorAt(u, sn) -> THREE.Color, dark: THREE.Color }
 * returns { geometry (groups: 0 top, 1 bottom, 2 walls; attributes position/color/uv), stats }
 */
export function buildOpenSole(S, o) {
  const mode = o.mode === 'lattice' ? 'lattice' : 'holes', pr = { ...(OPENING_PRESETS[mode][o.density] || OPENING_PRESETS[mode].med) };
  if (mode === 'holes' && o.d) { pr.d = clamp(+o.d, 2, 5); pr.pitch = Math.max(pr.pitch, pr.d + 2.2); } // staff-selected hole diameter; spacing never below d + 2.2 mm
  const wall = Math.max(MIN_WALL, mode === 'holes' ? (o.wall ?? 1.6) : pr.wall), rim = o.rimMargin ?? (mode === 'holes' ? 5 : 7);
  const allow = o.allow || defaultAllow(mode);
  const Lphys = Math.abs(S(1, 0).l - S(0, 0).l);
  const hwAt = ui => Math.hypot(S(ui, 1).x - S(ui, -1).x, S(ui, 1).l - S(ui, -1).l) / 2;
  let hwRef = 0; for (let k = 0; k <= 60; k++) hwRef = Math.max(hwRef, hwAt(k / 60));
  // tile size (mm)
  let Tu, Ts;
  if (mode === 'holes') { Tu = Ts = pr.pitch; } else { Ts = pr.cell; Tu = 2 * (pr.cell - wall) / Math.sqrt(3) + wall; }
  const mu = 4, ms = 4, pu = Tu / Lphys, ps = Ts / hwRef;
  // grid lines in ui: clustered ends (solid, round heel/toe) + uniform tile rows
  const uaMin = (rim + 1) / Lphys, nTu = Math.max(0, Math.floor((1 - 2 * uaMin) / pu)), ua = (1 - nTu * pu) / 2;
  const nEnd = Math.max(6, Math.ceil(ua * Lphys / 1.6)), U = [];
  for (let k = 0; k < nEnd; k++) U.push(ua * (1 - Math.cos(k / nEnd * Math.PI / 2)));
  for (let k = 0; k <= nTu * mu; k++) U.push(ua + k * pu / mu);
  for (let k = nEnd - 1; k >= 0; k--) U.push(1 - ua * (1 - Math.cos(k / nEnd * Math.PI / 2)));
  // grid lines in sn: clustered rim + uniform tile columns
  const eS = Math.min(.6, (rim * .6) / hwRef), nTs = Math.max(0, Math.floor((2 - 2 * eS) / ps)), sa = -nTs * ps / 2, nE = 6, SN = [];
  for (let k = 0; k < nE; k++) SN.push(-1 + (sa + 1) * (1 - Math.cos(k / nE * Math.PI / 2)));
  for (let k = 0; k <= nTs * ms; k++) SN.push(sa + k * ps / ms);
  for (let k = nE - 1; k >= 0; k--) SN.push(1 - (sa + 1) * (1 - Math.cos(k / nE * Math.PI / 2)));
  const NUl = U.length, NSl = SN.length;
  // vertices (top & bottom share the param point list)
  const V = []; // {ui, sn, x, l, tz, bz, u}
  for (let i = 0; i < NUl; i++) for (let j = 0; j < NSl; j++) { const s = S(U[i], SN[j]); V.push({ ui: U[i], sn: SN[j], ...s }); }
  const gid = (i, j) => i * NSl + j;
  // outline polyline (physical) for rim clearance
  const outl = []; for (let i = 0; i < NUl; i++) outl.push([V[gid(i, 0)].x, V[gid(i, 0)].l]); for (let j = 1; j < NSl; j++) outl.push([V[gid(NUl - 1, j)].x, V[gid(NUl - 1, j)].l]);
  for (let i = NUl - 2; i >= 0; i--) outl.push([V[gid(i, NSl - 1)].x, V[gid(i, NSl - 1)].l]); for (let j = NSl - 2; j > 0; j--) outl.push([V[gid(0, j)].x, V[gid(0, j)].l]);
  const rimDist = (x, l) => { let m = Infinity; for (let k = 0; k < outl.length; k++) { const a = outl[k], b = outl[(k + 1) % outl.length]; m = Math.min(m, d2seg(x, l, a[0], a[1], b[0], b[1])); } return m; };
  // place openings tile by tile
  const covered = new Uint8Array((NUl - 1) * (NSl - 1)), openings = [];
  for (let r = 0; r < nTu; r++) {
    const i0 = nEnd + r * mu, shift = (r % 2) * (ms / 2);
    for (let c = 0; ; c++) {
      const j0 = nE + shift + c * ms; if (j0 + ms > nE + nTs * ms) break;
      const u0 = U[i0], u1 = U[i0 + mu], s0 = SN[j0], s1 = SN[j0 + ms], uc = (u0 + u1) / 2, sc = (s0 + s1) / 2, cen = S(uc, sc);
      if (!allow(cen.u, sc)) continue;
      const pA = S(u0, sc), pB = S(u1, sc), pC = S(uc, s0), pD = S(uc, s1);
      const Lu = Math.hypot(pB.x - pA.x, pB.l - pA.l), Ls = Math.hypot(pD.x - pC.x, pD.l - pC.l);
      let n, rad, minScale;
      if (mode === 'holes') { n = 12; rad = pr.d / 2; minScale = 0.86; if (Math.min(Lu, Ls) < pr.d + wall) continue; }
      else { n = 6; rad = Math.min((Ls - wall) / Math.sqrt(3), (Lu - wall) / 2); minScale = 1.8 / Math.max(rad, 1e-6); if (rad < 1.8) continue; }
      // block border (physical) for the wall check
      const border = [];
      for (let i = i0; i < i0 + mu; i++) border.push(gid(i, j0)); for (let j = j0; j < j0 + ms; j++) border.push(gid(i0 + mu, j));
      for (let i = i0 + mu; i > i0; i--) border.push(gid(i, j0 + ms)); for (let j = j0 + ms; j > j0; j--) border.push(gid(i0, j));
      let ok = null;
      for (const sc2 of [1, .94, .88, .82, .76, .7]) {
        if (sc2 < minScale) break;
        const pts = [];
        for (let k = 0; k < n; k++) { const th = 2 * Math.PI * k / n + (mode === 'holes' ? Math.PI / n : 0); pts.push([uc + rad * sc2 * Math.cos(th) / Lu * (u1 - u0), sc + rad * sc2 * Math.sin(th) / Ls * (s1 - s0)]); }
        const ph = pts.map(([a, b]) => { const s = S(a, b); return { ui: a, sn: b, ...s }; });
        let dB = Infinity, dR = Infinity;
        for (const q of ph) { for (let k = 0; k < border.length; k++) { const A = V[border[k]], B = V[border[(k + 1) % border.length]]; dB = Math.min(dB, d2seg(q.x, q.l, A.x, A.l, B.x, B.l)); } dR = Math.min(dR, rimDist(q.x, q.l)); }
        if (dB >= wall / 2 - 1e-6 && dR >= rim) { ok = { ph, border, i0, j0, r, c, dB, dR }; break; }
        if (dR < rim * .5) break;
      }
      if (!ok) continue;
      openings.push(ok);
      for (let i = i0; i < i0 + mu; i++) for (let j = j0; j < j0 + ms; j++) covered[i * (NSl - 1) + j] = 1;
    }
  }
  // ---------- mesh ----------
  const topIdx = [], wallP = [], wallIdx = [];
  const VV = V.slice(); // + opening vertices
  const tri = (arr, a, b, c) => { // enforce CCW in (ui, sn)
    const A = VV[a], B = VV[b], C = VV[c], s = (B.ui - A.ui) * (C.sn - A.sn) - (C.ui - A.ui) * (B.sn - A.sn);
    if (s >= 0) arr.push(a, b, c); else arr.push(a, c, b);
  };
  for (let i = 0; i < NUl - 1; i++) for (let j = 0; j < NSl - 1; j++) if (!covered[i * (NSl - 1) + j]) {
    const a = gid(i, j), b = gid(i + 1, j), c = gid(i + 1, j + 1), d = gid(i, j + 1); topIdx.push(a, b, c, a, c, d);
  }
  const addWall = loop => { // loop ordered with material on the LEFT (CCW outer / CW hole) in (ui, sn)
    const base = wallP.length / 3;
    for (const k of loop) { const v = VV[k]; wallP.push(v.x, v.tz, v.l, v.x, v.bz, v.l); }
    const L = loop.length;
    for (let k = 0; k < L; k++) { const t0 = base + 2 * k, b0 = t0 + 1, t1 = base + 2 * ((k + 1) % L), b1 = t1 + 1; wallIdx.push(t1, t0, b0, t1, b0, b1); }
  };
  for (const op of openings) {
    const cu = (U[op.i0] + U[op.i0 + mu]) / 2, cs = (SN[op.j0] + SN[op.j0 + ms]) / 2, ku = Lphys, ks = hwAt(cu);
    const ang = v => Math.atan2((v.sn - cs) * ks, (v.ui - cu) * ku);
    const inner = op.ph.map(p => { VV.push(p); return VV.length - 1; });
    const sortLoop = ids => { const a = ids.map(id => [id, ang(VV[id])]); let m = 0; for (let k = 1; k < a.length; k++) if (a[k][1] < a[m][1]) m = k; const out = a.slice(m).concat(a.slice(0, m)); let prev = -Infinity; for (const e of out) { while (e[1] < prev) e[1] += 2 * Math.PI; prev = e[1]; } return out; };
    const O = sortLoop(op.border), I = sortLoop(inner);
    O.push([O[0][0], O[0][1] + 2 * Math.PI]); I.push([I[0][0], I[0][1] + 2 * Math.PI]);
    // align start angles
    let p = 0, q = 0;
    if (I[0][1] < O[0][1]) { /* fine */ }
    while (p < O.length - 1 || q < I.length - 1) {
      const advO = q >= I.length - 1 || (p < O.length - 1 && O[p + 1][1] <= I[q + 1][1]);
      if (advO) { tri(topIdx, O[p][0], O[p + 1][0], I[q][0]); p++; } else { tri(topIdx, O[p][0], I[q + 1][0], I[q][0]); q++; }
    }
    addWall(inner.slice().reverse());
  }
  // outer wall (CCW in param space)
  const outer = []; for (let i = 0; i < NUl - 1; i++) outer.push(gid(i, 0)); for (let j = 0; j < NSl - 1; j++) outer.push(gid(NUl - 1, j));
  for (let i = NUl - 1; i > 0; i--) outer.push(gid(i, NSl - 1)); for (let j = NSl - 1; j > 0; j--) outer.push(gid(0, j));
  addWall(outer);
  // assemble: top | bottom | walls
  const nV = VV.length, pos = new Float32Array((2 * nV) * 3 + wallP.length), col = new Float32Array(pos.length), uv = new Float32Array(pos.length / 3 * 2);
  const dark = o.dark || new THREE.Color('#888');
  for (let k = 0; k < nV; k++) {
    const v = VV[k], c = o.colorAt ? o.colorAt(v.u, v.sn) : dark;
    pos.set([v.x, v.tz, v.l], 3 * k); col.set([c.r, c.g, c.b], 3 * k); uv.set([(v.sn + 1) / 2, v.ui], 2 * k);
    pos.set([v.x, v.bz, v.l], 3 * (nV + k)); col.set([dark.r, dark.g, dark.b], 3 * (nV + k)); uv.set([(v.sn + 1) / 2, v.ui], 2 * (nV + k));
  }
  pos.set(wallP, 6 * nV); for (let k = 2 * nV; k < pos.length / 3; k++) col.set([dark.r, dark.g, dark.b], 3 * k);
  const botIdx = []; for (let k = 0; k < topIdx.length; k += 3) botIdx.push(nV + topIdx[k], nV + topIdx[k + 2], nV + topIdx[k + 1]);
  const wIdx = wallIdx.map(k => k + 2 * nV), index = topIdx.concat(botIdx, wIdx);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index); geo.addGroup(0, topIdx.length, 0); geo.addGroup(topIdx.length, botIdx.length, 1); geo.addGroup(topIdx.length + botIdx.length, wIdx.length, 2);
  geo.computeVertexNormals();
  // ---------- stats (physical, mm) ----------
  const polys = openings.map(op => op.ph.map(p => [p.x, p.l]));
  let minBetween = Infinity, minRim = Infinity;
  const key = op => op.r + ',' + op.c, byKey = new Map(openings.map((op, k) => [key(op), k]));
  openings.forEach((op, k) => { minRim = Math.min(minRim, op.dR); for (let dr = 0; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && dc <= 0) continue; const k2 = byKey.get((op.r + dr) + ',' + (op.c + dc)); if (k2 != null) minBetween = Math.min(minBetween, polyDist(polys[k], polys[k2])); } });
  const openArea = polys.reduce((s, P) => s + area2(P), 0), soleArea = area2(outl);
  let minThick = Infinity; for (const v of VV) minThick = Math.min(minThick, v.tz - v.bz);
  const stats = { mode, density: o.density || 'med', preset: pr.label, spacingMm: mode === 'holes' ? pr.pitch : undefined, openings: openings.length, holeDiameterMm: mode === 'holes' ? pr.d : undefined, cellMm: mode === 'lattice' ? pr.cell : undefined,
    targetWallMm: wall, minWallBetweenOpeningsMm: isFinite(minBetween) ? +minBetween.toFixed(2) : null, minRimMm: isFinite(minRim) ? +minRim.toFixed(2) : null,
    openAreaPct: +(100 * openArea / soleArea).toFixed(1), minMaterialThicknessMm: +minThick.toFixed(2), triangles: index.length / 3 };
  return { geometry: geo, stats };
}
