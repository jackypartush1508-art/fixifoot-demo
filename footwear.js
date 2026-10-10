// Fixifoot v13 – scan-fitted footwear parts for the Contour Two-Strap sandal and the Comfort Clog.
// Every part is a closed, consistently oriented shell built from a 2D (ui = along, sn = across) plan (multi.planSplit) with
// an inner and an outer surface: openings (vents, strap holes) are real through-holes and the strap pins are real geometry.
// Frame = the sole frame of fit.buildContactSole: Y up, x across, z along the foot (heel at larger z).
import * as THREE from 'three';
import { planSplit } from './multi.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const SHOE = {
  sandal: { strapW: 26, strapT: 3.2, gap: 1.2, notch: 1.6, side: .25, tabBottom: 2.5, holeD: 4, buckle: 1.8, uRear: .52, dFront: .01 },
  clog: { u0: .56, wall: 2.8, gap: .5, clearTop: 7, clearSide: 3, yB: 3, nose: 30, n: 2.6, minH: 18, vent: { cell: 15, wall: 4.5 },
    flare: 14, strapH: 18, strapT: 3, pad: 1.2, pinH: 4.4, pinR: 3.1, holeD: 5.0, strapOff: 6 },
};

/* ---------- 1. top-of-foot envelope (max height per foot-u / across bin), from the scan mesh or the model foot ---------- */
const EDU = .025, ENU = 43, EDX = 2.5, EX0 = -75, ENX = 61;
export function measureUpper(geo, md) {
  const P = geo.attributes.position, I = geo.index ? geo.index.array : null, h = Array.from({ length: ENU }, () => new Float32Array(ENX));
  const put = (x, y, z) => { const u = md.uOfZ(z); if (u < -.02 || u > 1.06) return; const r = md.rowAt(z), xr = (x - (r.lo + r.hi) / 2) * md.medialX;
    const bu = clamp(Math.round(u / EDU), 0, ENU - 1), bx = Math.round((xr - EX0) / EDX); if (bx < 0 || bx >= ENX) return; if (y > h[bu][bx]) h[bu][bx] = y; };
  const nT = I ? I.length / 3 : P.count / 3, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < nT; t++) { // sample every triangle (coarse model meshes leave no empty bins)
    a.fromBufferAttribute(P, I ? I[3 * t] : 3 * t); b.fromBufferAttribute(P, I ? I[3 * t + 1] : 3 * t + 1); c.fromBufferAttribute(P, I ? I[3 * t + 2] : 3 * t + 2);
    const n = clamp(Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / 2), 1, 12);
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const wa = i / n, wb = j / n, wc = 1 - wa - wb; put(a.x * wa + b.x * wb + c.x * wc, a.y * wa + b.y * wb + c.y * wc, a.z * wa + b.z * wb + c.z * wc); }
  }
  let inst = 0; for (let k = 18; k <= 22; k++) for (const v of h[k]) inst = Math.max(inst, v);
  return { du: EDU, dx: EDX, x0: EX0, h: h.map(r => Array.from(r, v => Math.round(v))), instepMm: Math.round(inst), valid: inst > .14 * md.L };
}
// highest foot point over foot-u in [uA, uB] at absolute x (0 = no foot there)
function envMax(E, md, uA, uB, x) {
  let m = 0; const b0 = clamp(Math.ceil(Math.min(uA, uB) / E.du - .5), 0, E.h.length - 1), b1 = clamp(Math.floor(Math.max(uA, uB) / E.du + .5), 0, E.h.length - 1);
  for (let b = b0; b <= b1; b++) { const r = md.rowAt(md.zOfU(b * E.du)), xr = (x - (r.lo + r.hi) / 2) * md.medialX, f = (xr - E.x0) / E.dx, i = Math.floor(f);
    for (const k of [i, i + 1]) if (k >= 0 && k < E.h[b].length) m = Math.max(m, E.h[b][k]); }
  return m;
}

/* ---------- 2. closed shell from a plan: inner surface I(v), outer surface O(v), boundary walls ---------- */
function shellBody(plan, include, I, O) {
  const { VV, tris } = plan, sel = tris.filter(include), used = new Map(), pos = [], idx = [];
  const vid = (k, out) => { const key = k * 2 + (out ? 1 : 0); let v = used.get(key); if (v == null) { const p = (out ? O : I)(VV[k]); v = pos.length / 3; pos.push(p[0], p[1], p[2]); used.set(key, v); } return v; };
  const edges = new Map(), EK = (a, b) => a * 1048576 + b;
  for (const t of sel) { idx.push(vid(t.a, 1), vid(t.b, 1), vid(t.c, 1)); idx.push(vid(t.a, 0), vid(t.c, 0), vid(t.b, 0)); for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) edges.set(EK(a, b), [a, b]); }
  for (const [, [a, b]] of edges) if (!edges.has(EK(b, a))) { const ta = vid(a, 1), tb = vid(b, 1), ba = vid(a, 0), bb = vid(b, 0); idx.push(tb, ta, ba, tb, ba, bb); }
  let vol = 0; for (let i = 0; i < idx.length; i += 3) { const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6; }
  if (vol < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } vol = -vol; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { geometry: g, volumeMm3: Math.round(vol), triangles: idx.length / 3 };
}
// polyline helpers (2D)
const plen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
function resample(P, n) {
  const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1], out = []; let k = 0;
  for (let i = 0; i < n; i++) { const s = L * i / (n - 1); while (k < P.length - 2 && cum[k + 1] < s) k++; const f = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1); out.push([lerp(P[k][0], P[k + 1][0], f), lerp(P[k][1], P[k + 1][1], f)]); }
  return out;
}
function chaikin(P, it = 2) { for (let r = 0; r < it; r++) { const Q = [P[0]]; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; Q.push([.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]], [.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]]); } Q.push(P[P.length - 1]); P = Q; } return P; }
// path sampler: ui in [0,1] -> point + unit normal (normals point away from `ref`)
function pathSampler(P, ref) {
  const n = P.length, N = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; let nx = ty / l, ny = -tx / l;
    if (nx * (p[0] - ref[0]) + ny * (p[1] - ref[1]) < 0) { nx = -nx; ny = -ny; } return [nx, ny]; });
  return ui => { const f = clamp(ui, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(f)), t = f - i, nx = lerp(N[i][0], N[i + 1][0], t), ny = lerp(N[i][1], N[i + 1][1], t), l = Math.hypot(nx, ny) || 1;
    return { p: [lerp(P[i][0], P[i + 1][0], t), lerp(P[i][1], P[i + 1][1], t)], n: [nx / l, ny / l] }; };
}
// band plan (developed: along = arc length, across = width) with optional through-holes
function bandPlan(Lp, W, holes = []) {
  const S = (ui, sn) => ({ x: sn * W / 2, l: ui * Lp, tz: 0, bz: 0, u: ui });
  return planSplit(S, { rimMargin: 3, extras: holes.map((h, k) => ({ id: 'hole' + k, u: h.u, sn: h.sn || 0, ru: h.r, rs: h.r, n: 20, minRim: 1.5 })) });
}
const isInsertHole = plan => t => !(t.t === 'i' && plan.feats[t.f].kind === 'insert');
// one transform to the print bed: Z-up, centred, bottom on Z = 0
export function toBed(geo, rotX = 0) {
  const g = geo.clone(); if (rotX) g.rotateX(rotX); g.computeBoundingBox(); const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z); g.computeVertexNormals(); return g;
}

/* ---------- 3. sole helpers ---------- */
function rowTools(rows, md) {
  const N = rows.length, M = rows[0].length, mid = (M - 1) >> 1;
  const iOfZ = z => { let b = 0, bd = Infinity; for (let i = 0; i < N; i++) { const d = Math.abs(rows[i][mid].z - z); if (d < bd) { bd = d; b = i; } } return b; };
  const lift = u => { const v = rows[iOfZ(md.zOfU(clamp(u, 0, 1)))][mid]; return Math.max(2, v.tz - Math.min(md.sampleF(v.x, v.z), md.archCap)); };
  return { N, M, mid, iOfZ, lift };
}
// sandal: strap stations (foot-u) and the 1.6 mm side notch they sit in (passed to buildContactSole as params._notch)
export function sandalStations(md) { const C = SHOE.sandal, W = C.strapW * clamp(md.L / 250, .85, 1.1);
  return { W, list: [{ id: 'strapFront', name: 'Front strap (forefoot)', u: clamp(md.ballU - C.dFront, .64, .74) }, { id: 'strapRear', name: 'Rear strap (instep)', u: C.uRear }] }; }
export function sandalNotch(md) { const st = sandalStations(md), zs = st.list.map(s => md.zOfU(s.u));
  return z => { let m = 0; for (const zk of zs) m = Math.max(m, 1 - smooth(st.W / 2 + .3, st.W / 2 + 1.3, Math.abs(z - zk))); return SHOE.sandal.notch * m; }; }

/* ---------- 4. Contour Two-Strap: two wide straps, arched over the scanned foot ---------- */
function sandalStraps({ md, rows, env }) {
  const C = SHOE.sandal, T = rowTools(rows, md), st = sandalStations(md), W = st.W, sg = md.medialX, parts = [];
  for (const d of st.list) {
    const zk = md.zOfU(d.u), inRange = rows.map((r, i) => i).filter(i => Math.abs(rows[i][T.mid].z - zk) <= W / 2 + .5);
    let xM = -Infinity * sg, xL = Infinity * sg, tzM = 0, tzL = 0;
    for (const i of inRange) { const m = rows[i][T.M - 1], l = rows[i][0]; if (m.x * sg > xM * sg) xM = m.x; if (l.x * sg < xL * sg) xL = l.x; tzM = Math.max(tzM, m.tz); tzL = Math.max(tzL, l.tz); }
    const xMs = xM + sg * C.side, xLs = xL - sg * C.side, top = Math.max(tzM, tzL) + 3, lf = T.lift(d.u), uA = md.uOfZ(zk + W / 2), uB = md.uOfZ(zk - W / 2);
    // required inner line: above the foot envelope (+gap), outside the sole edges -> upper convex hull = the strap arch
    const pts = [[xMs, tzM + 3], [xLs, tzL + 3]]; let envPeak = 0;
    for (let x = Math.min(xMs, xLs) + 1; x < Math.max(xMs, xLs) - 1; x += 2) { const e = envMax(env, md, uA, uB, x); if (e > 0) { pts.push([x, lf + e + C.gap]); envPeak = Math.max(envPeak, lf + e); } }
    pts.sort((a, b) => a[0] - b[0]); const hull = [];
    for (const p of pts) { while (hull.length >= 2) { const a = hull[hull.length - 2], b = hull[hull.length - 1]; if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0) hull.pop(); else break; } hull.push(p); }
    if (hull[0][0] !== Math.min(xMs, xLs)) hull.unshift(pts[0]);
    let arch = hull[0][0] === xMs ? hull : hull.slice().reverse(); // medial -> lateral
    let path = chaikin([[xMs, C.tabBottom], [xMs, tzM + 3], ...arch.slice(1, -1), [xLs, tzL + 3], [xLs, C.tabBottom]], 3);
    const lo = Math.min(xMs, xLs), hi = Math.max(xMs, xLs);
    path = path.map(([x, y]) => (y < top && x > lo + .01 && x < hi - .01) ? [Math.abs(x - xMs) < Math.abs(x - xLs) ? xMs : xLs, y] : [x, y]); // never cut into the sole edge
    const Lp = plen(path), Pn = resample(path, Math.max(80, Math.ceil(Lp / .8))), ps = pathSampler(Pn, [(xMs + xLs) / 2, C.tabBottom + 8]);
    // lateral side: raised slider frame + 3 adjustment holes (adjustable look; the strap is sized from the scan)
    const tabL = tzL + 3 - C.tabBottom, dB = tabL + 22, uOfD = dd => 1 - dd / Lp, bU = uOfD(dB);
    const holes = [0, 1, 2].map(k => ({ u: uOfD(dB + 16 + 7 * k), r: C.holeD / 2 }));
    const bump = (ui, sn) => C.buckle * (1 - smooth(.72, 1, Math.max(Math.abs(ui - bU) * Lp / 9, Math.abs(sn) / .82)));
    const plan = bandPlan(Lp, W, holes), I = v => { const q = ps(v.ui); return [q.p[0], q.p[1], zk + v.sn * W / 2]; };
    const O = v => { const q = ps(v.ui), t = C.strapT + bump(v.ui, v.sn); return [q.p[0] + q.n[0] * t, q.p[1] + q.n[1] * t, zk + v.sn * W / 2]; };
    const b = shellBody(plan, isInsertHole(plan), I, O);
    const pg = toBed(b.geometry); // printed on edge: arch in XY, strap width along Z (no supports)
    parts.push({ id: d.id, name: d.name, geometry: b.geometry, printGeometry: pg, volumeMm3: b.volumeMm3,
      stats: { footU: +d.u.toFixed(3), widthMm: +W.toFixed(1), thicknessMm: C.strapT, lengthMm: Math.round(Lp), archTopMm: Math.round(Math.max(...Pn.map(p => p[1]))), clearanceOverFootMm: C.gap, footTopUnderStrapMm: Math.round(envPeak), adjustmentHoles: 3, orientation: 'on edge (strap width vertical), arch flat on the bed' } });
  }
  return parts;
}

/* ---------- 5. Comfort Clog: roomy toe-box upper with honeycomb vents + pivoting heel strap ---------- */
function clogParts({ md, rows, frame: F, env, heelStrap = true }) {
  const C = SHOE.clog, T = rowTools(rows, md), sg = md.medialX, n = C.n, yB = C.yB;
  const z0 = md.zOfU(C.u0), zEi = F.zFront - C.gap;
  const edgeZ = z => F.edge(clamp((F.zBack - z) / F.Li, 0, 1));
  const NT = 150, NA = 121, NW = 16, R = [];
  const frac = q => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(q)), n)), 1 / n);
  // section = straight side walls (yB -> yW, wrapping the sole side) + superellipse roof (yW -> H)
  const ZI = Array.from({ length: NT + 1 }, (_, k) => lerp(z0, zEi, k / NT)), EI = ZI.map(edgeZ), AI = EI.map(e => e.half + C.gap), len = z0 - zEi;
  const LF = ZI.map(z => T.lift(clamp(md.uOfZ(z), 0, 1))), DT = ZI.map(z => z - zEi);
  const YS = ZI.map(z => { const r = rows[T.iOfZ(Math.max(z, F.zFront))]; return Math.max(r[0].tz, r[T.M - 1].tz) + 1; }); // sole edge top: the upper wraps the sole side wall up to here
  const FOOT = ZI.map((zi, k) => { const e = EI[k], a = AI[k], out = [];
    for (let x = e.c - a - C.flare + 1; x <= e.c + a + C.flare - 1; x += 2) { const ev = envMax(env, md, md.uOfZ(zi + 3), md.uOfZ(zi - 3), x); if (ev <= 0) continue; const q = (x - e.c) / a;
      out.push([x - e.c, LF[k] + ev + lerp(C.clearTop, C.clearSide, smooth(.5, .85, Math.abs(q)))]); } return out; });
  // roof height + per-side roof half-width (the walls may flare out above the sole so the roof clears the scanned foot)
  const solveRow = (k, yW) => { const a = AI[k], pts = FOOT[k].filter(p => p[1] > yW); if (!pts.length) return { H: DT[k] > C.nose ? yW + 10 : yB + 2, aM: a, aL: a };
    const Ymax = Math.max(...pts.map(p => p[1]));
    for (let Ht = Ymax + 3; ; Ht += 2) { let aM = a, aL = a;
      for (const [dx, y] of pts) { const r = (y - yW) / (Ht - yW), g = Math.pow(Math.max(1e-6, 1 - Math.pow(r, n)), 1 / n), need = Math.abs(dx) / g + .5; if (dx * sg >= 0) aM = Math.max(aM, need); else aL = Math.max(aL, need); }
      if ((aM <= a + C.flare && aL <= a + C.flare) || Ht > Ymax + (DT[k] > C.nose ? 40 : 12)) return { H: Ht, aM: Math.min(aM, a + C.flare), aL: Math.min(aL, a + C.flare) }; } };
  const runMax = (A, r) => A.map((_, i) => Math.max(...A.slice(Math.max(0, i - r), i + r + 1))), runMean = (A, r) => A.map((_, i) => { const s = A.slice(Math.max(0, i - r), i + r + 1); return s.reduce((x, y) => x + y, 0) / s.length; });
  const YW0 = LF.map((l, k) => Math.max(l + 16, YS[k] + 8)), kN = clamp(Math.round((1 - C.nose / len) * NT), 0, NT), sm = A => runMean(runMax(A, 4), 6);
  const shape = YW => { const sol = YW.map((w, k) => solveRow(k, w)), Hr = sol.map(x => x.H); let H = sm(Hr); const HN = H[kN];
    H = H.map((h, k) => { const d = DT[k]; if (d >= C.nose) return Math.max(h, Hr[k]); return Math.max(Hr[k], yB + (HN - yB) * Math.sqrt(Math.max(0, 1 - ((C.nose - d) / C.nose) ** 2))); });
    const aM = sm(sol.map(x => x.aM)).map((v, k) => Math.max(v, AI[k])), aL = sm(sol.map(x => x.aL)).map((v, k) => Math.max(v, AI[k])); return { H, aM, aL }; };
  let SH = shape(YW0), YW = YW0.map((w, k) => Math.min(w, yB + .55 * (SH.H[k] - yB)));
  SH = shape(YW); YW = YW0.map((w, k) => Math.min(w, yB + .55 * (SH.H[k] - yB)));
  const H = SH.H.map((h, k) => Math.max(h, YW[k] + 1));
  for (let k = 0; k <= NT; k++) {
    const t = k / NT, zi = ZI[k], ei = EI[k], Hi = H[k], Ho = Hi + C.wall * (1 - smooth(.94, 1, t)), yW = YW[k], yS = Math.min(YS[k], yB + .6 * (yW - yB));
    // outer outline = inner outline offset by the wall thickness along its plan normal (true offset round the toe)
    const k0 = Math.max(0, k - 1), k1 = Math.min(NT, k + 1), dadz = (AI[k1] - AI[k0]) / ((ZI[k0] - ZI[k1]) || 1), th = k === NT ? Math.PI / 2 : dadz < 0 ? Math.atan(-dadz) : 0;
    const ct = Math.cos(th), ai = AI[k], zo = zi - C.wall * Math.sin(th), c = ei.c, aMi = SH.aM[k], aLi = SH.aL[k];
    const sec = (a, aM, aL, Ht, z) => { const P = [], h = NW / 2;
      for (let m = 0; m < h; m++) P.push([c + sg * a, yB + (yS - yB) * m / h, z]);
      for (let m = 0; m < h; m++) P.push([c + sg * lerp(a, aM, m / h), yS + (yW - yS) * m / h, z]);
      for (let m = 0; m < NA; m++) { const ph = Math.PI * m / (NA - 1), cs = Math.cos(ph); P.push([c + sg * Math.sign(cs) * (cs >= 0 ? aM : aL) * Math.pow(Math.abs(cs), 2 / n), yW + (Ht - yW) * Math.pow(Math.sin(ph), 2 / n), z]); }
      for (let m = h - 1; m >= 0; m--) P.push([c - sg * lerp(a, aL, m / h), yS + (yW - yS) * m / h, z]);
      for (let m = h - 1; m >= 0; m--) P.push([c - sg * a, yB + (yS - yB) * m / h, z]); return P; };
    const PI_ = sec(ai, aMi, aLi, Hi, zi), PO = sec(ai + C.wall * ct, aMi + C.wall * ct, aLi + C.wall * ct, Ho, zo), cum = [0];
    for (let m = 1; m < PI_.length; m++) cum.push(cum[m - 1] + Math.hypot(PI_[m][0] - PI_[m - 1][0], PI_[m][1] - PI_[m - 1][1]));
    const tot = cum[cum.length - 1]; R.push({ zi, Hi, Ho, PI: PI_, PO, s: cum.map(v => 1 - 2 * v / tot), half: tot / 2 });
  }
  let ridge = [0]; for (let k = 1; k <= NT; k++) ridge.push(ridge[k - 1] + Math.hypot(R[k].zi - R[k - 1].zi, R[k].Hi - R[k - 1].Hi));
  const inRow = (r, s, out) => { const A = r.s, NPt = A.length; let lo = 0, hi = NPt - 1; if (s >= A[0]) return (out ? r.PO : r.PI)[0]; if (s <= A[NPt - 1]) return (out ? r.PO : r.PI)[NPt - 1];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] >= s) lo = m; else hi = m; } const f = (A[lo] - s) / ((A[lo] - A[hi]) || 1), P = out ? r.PO : r.PI;
    return [lerp(P[lo][0], P[hi][0], f), lerp(P[lo][1], P[hi][1], f), lerp(P[lo][2], P[hi][2], f)]; };
  const at = (ui, sn, out) => { const f = clamp(ui, 0, 1) * NT, k = Math.min(NT - 1, Math.floor(f)), w = f - k, A = inRow(R[k], sn, out), B = inRow(R[k + 1], sn, out); return [lerp(A[0], B[0], w), lerp(A[1], B[1], w), lerp(A[2], B[2], w)]; };
  const S = (ui, sn) => { const f = clamp(ui, 0, 1) * NT, k = Math.min(NT - 1, Math.floor(f)), w = f - k; return { x: sn * lerp(R[k].half, R[k + 1].half, w), l: lerp(ridge[k], ridge[k + 1], w), tz: 0, bz: 0, u: ui }; };
  // heel-strap pivots: on the side walls just in front of the throat, at the strap height
  const extras = []; let piv = null;
  if (heelStrap) {
    let yP = 0; for (let i = 0; i < T.N; i++) { const rr = rows[i]; if (rr[T.mid].z < z0) continue; yP = Math.max(yP, rr[0].tz, rr[T.M - 1].tz); }
    const uiP = clamp(10 / ridge[NT], .03, .2), rP = R[Math.round(uiP * NT)]; yP = clamp(Math.max(yP + C.strapH / 2 + 3, yB + .45 * (rP.Hi - yB)), yB + 12, rP.Hi - 14);
    const snAt = side => { let lo = side > 0 ? 0 : -1, hi = side > 0 ? 1 : 0; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2, y = at(uiP, m, false)[1]; if ((y > yP) === (side > 0)) lo = m; else hi = m; } return (lo + hi) / 2; };
    piv = { uiP, yP, M: snAt(1), L: snAt(-1) };
    extras.push({ id: 'pinM', u: uiP, sn: piv.M, ru: C.pinR, rs: C.pinR, n: 20, minRim: 2 }, { id: 'pinL', u: uiP, sn: piv.L, ru: C.pinR, rs: C.pinR, n: 20, minRim: 2 });
  }
  const plan = planSplit(S, { mode: 'lattice', preset: { ...C.vent }, rimMargin: 9, allow: (u, sn) => u > .18 && u < .76 && Math.abs(sn) < .36, extras });
  const devAt = (ui, sn) => { const s = S(ui, sn); return [s.x, s.l]; };
  const pinD = piv ? ['M', 'L'].map(k => { const d = devAt(piv.uiP, piv[k]); return d; }) : [];
  const bumpAt = v => { if (!piv) return 0; let b = 0; for (const d of pinD) { const s = S(v.ui, v.sn), r = Math.hypot(s.x - d[0], s.l - d[1]);
    b = Math.max(b, C.pad * (1 - smooth(5, 8, r)) + C.pinH * (1 - smooth(C.pinR * .62, C.pinR * .9, r))); } return b; };
  const Ifn = v => at(v.ui, v.sn, false), Ofn = v => { const o = at(v.ui, v.sn, true), b = bumpAt(v); if (!b) return o; const i = at(v.ui, v.sn, false), d = [o[0] - i[0], o[1] - i[1], o[2] - i[2]], l = Math.hypot(...d) || 1; return [o[0] + d[0] / l * b, o[1] + d[1] / l * b, o[2] + d[2] / l * b]; };
  const isVent = t => t.t === 'i' && plan.feats[t.f].kind === 'cell';
  const vents = plan.feats.filter(f => f.kind === 'cell').length;
  const up = shellBody(plan, t => !isVent(t), Ifn, Ofn);
  const parts = [{ id: 'upper', name: 'Clog upper (toe box, honeycomb vents)', geometry: up.geometry, printGeometry: toBed(up.geometry, Math.PI / 2), volumeMm3: up.volumeMm3,
    stats: { throatFootU: C.u0, wallMm: C.wall, toeAllowanceMm: +(md.zToe - zEi).toFixed(1), clearanceTopMm: C.clearTop, clearanceSideMm: C.clearSide, heightMm: Math.round(Math.max(...R.map(r => r.Ho))), roofProfileMm: H.filter((_, k) => k % 15 === 0).map(Math.round), wallTopMm: YW.filter((_, k) => k % 15 === 0).map(Math.round), roofHalfMm: SH.aM.filter((_, k) => k % 15 === 0).map(Math.round), vents, ventCellMm: C.vent.cell, ventWallMm: C.vent.wall, orientation: 'upright, rim down; organic supports under the toe-box roof only' } }];
  if (piv) { // pivoting heel strap: band around the heel, outside the sole outline, holes over the pins
    const pM = Ofn({ ui: piv.uiP, sn: piv.M }), pL = Ofn({ ui: piv.uiP, sn: piv.L }), iM = Ifn({ ui: piv.uiP, sn: piv.M }), iL = Ifn({ ui: piv.uiP, sn: piv.L });
    const padM = Ofn({ ui: piv.uiP + 5.5 / ridge[NT], sn: piv.M }), padL = Ofn({ ui: piv.uiP + 5.5 / ridge[NT], sn: piv.L }); // pad surface next to the pin
    const dirM = [pM[0] - iM[0], pM[2] - iM[2]], dirL = [pL[0] - iL[0], pL[2] - iL[2]], nd = d => { const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };
    const nM = nd(dirM), nL = nd(dirL), sM = [padM[0] + nM[0] * 0.15, pM[2]], sL = [padL[0] + nL[0] * 0.15, pL[2]]; // strap inner face rests on the pin pad
    const zP = pM[2], back = [], N0 = rows[0].length;
    const outl = []; for (let i = T.iOfZ(zP + 14); i >= 0; i--) outl.push([rows[i][N0 - 1].x, rows[i][N0 - 1].z]); for (let j = N0 - 2; j >= 1; j--) outl.push([rows[0][j].x, rows[0][j].z]); for (let i = 0; i <= T.iOfZ(zP + 14); i++) outl.push([rows[i][0].x, rows[i][0].z]);
    const cx = outl.reduce((s, p) => s + p[0], 0) / outl.length, cz = outl.reduce((s, p) => s + p[1], 0) / outl.length, os = resample(outl, 90);
    for (let i = 0; i < os.length; i++) { const a = os[Math.max(0, i - 1)], b = os[Math.min(os.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1; let nx = tz / l, nz = -tx / l; if (nx * (os[i][0] - cx) + nz * (os[i][1] - cz) < 0) { nx = -nx; nz = -nz; } back.push([os[i][0] + nx * C.strapOff, os[i][1] + nz * C.strapOff]); }
    const lead = 8, pathRaw = [[sM[0], sM[1] - lead], sM, ...back, sL, [sL[0], sL[1] - lead]];
    const P2 = resample(chaikin(pathRaw, 3), 240), Lp = plen(P2), ps = pathSampler(P2, [cx, cz]);
    const proj = s => { let b = 0, bd = Infinity; P2.forEach((p, i) => { const d = Math.hypot(p[0] - s[0], p[1] - s[1]); if (d < bd) { bd = d; b = i; } }); return b / (P2.length - 1); };
    const hs = [proj(sM), proj(sL)], plan2 = bandPlan(Lp, C.strapH, hs.map(u => ({ u, r: C.holeD / 2 })));
    const I2 = v => { const q = ps(v.ui); return [q.p[0], piv.yP + v.sn * C.strapH / 2, q.p[1]]; }, O2 = v => { const q = ps(v.ui); return [q.p[0] + q.n[0] * C.strapT, piv.yP + v.sn * C.strapH / 2, q.p[1] + q.n[1] * C.strapT]; };
    const hb = shellBody(plan2, isInsertHole(plan2), I2, O2);
    parts.push({ id: 'heelStrap', name: 'Heel strap (pivots on the two pins)', geometry: hb.geometry, printGeometry: toBed(hb.geometry, Math.PI / 2), volumeMm3: hb.volumeMm3,
      stats: { heightMm: C.strapH, thicknessMm: C.strapT, lengthMm: Math.round(Lp), pivotHeightMm: Math.round(piv.yP), pinDiameterMm: +(C.pinR * 1.5).toFixed(1), pinLengthMm: C.pinH, strapHoleMm: C.holeD, holesFound: plan2.feats.filter(f => f.kind === 'insert').length, orientation: 'on edge (strap height vertical), no supports' } });
  }
  return parts;
}

/* ---------- 6. public: all extra bodies for a footwear product ---------- */
export function buildFootwear(type, ctx) { return type === 'sandal' ? sandalStraps(ctx) : type === 'clog' ? clogParts(ctx) : []; }

/* ---------- 7. print-bed check + rough print time ---------- */
export function bedFit(geos, bed = [220, 220, 250], margin = 5) { // Z-up geometries placed together; best rotation about Z
  const pts = []; let zMax = 0; for (const g of geos) { const P = g.attributes.position, st = Math.max(1, Math.floor(P.count / 4000)); for (let i = 0; i < P.count; i += st) { pts.push([P.getX(i), P.getY(i)]); zMax = Math.max(zMax, P.getZ(i)); } }
  let best = null;
  for (let a = 0; a < 180; a += 1) { const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { const X = x * c - y * s, Y = x * s + y * c; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
    const w = x1 - x0, h = y1 - y0, fits = w <= bed[0] - 2 * margin && h <= bed[1] - 2 * margin, score = (fits ? 0 : 1e6) + (a === 0 && fits ? -1 : 0) + Math.max(w / bed[0], h / bed[1]);
    if (!best || score < best.score) best = { score, angleDeg: a, w, h, fits }; }
  const edge = Math.min((bed[0] - best.w) / 2, (bed[1] - best.h) / 2); // free space left on the tightest side
  return { fits: best.fits && zMax <= bed[2], fitsTight: edge >= 1.5 && zMax <= bed[2], edgeMm: +edge.toFixed(1), angleDeg: best.angleDeg, footprintMm: [Math.round(best.w), Math.round(best.h)], heightMm: Math.round(zMax), bedMm: bed, marginMm: margin };
}
// printer bed presets (staff picks one; saved in localStorage 'fxBed')
export const BEDS = { k1c: { name: 'Creality K1C 220×220×250', mm: [220, 220, 250] }, b256: { name: '256×256×256 (Bambu-class)', mm: [256, 256, 256] }, b300: { name: '300×300×300 (K1 Max-class)', mm: [300, 300, 300] } };
export function currentBed() { let k = 'k1c'; try { k = localStorage.getItem('fxBed') || 'k1c'; } catch (e) {} return BEDS[k] ? k : 'k1c'; }
export function rotateOnBed(geos, deg) { if (!deg) return geos; const r = deg * Math.PI / 180; return geos.map(g => { const c = g.clone(); c.rotateZ(r); return c; }); }
export function surfaceArea(g) { const P = g.attributes.position, I = g.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let s = 0;
  for (let i = 0; i < I.length; i += 3) { a.fromBufferAttribute(P, I[i]); b.fromBufferAttribute(P, I[i + 1]).sub(a); c.fromBufferAttribute(P, I[i + 2]).sub(a); s += b.cross(c).length() / 2; } return s; }
// rough FDM time: 3 perimeters / 4-5 top+bottom layers ~ 1.1 mm skin over the whole surface, the rest at the infill %
export function printEstimate(volMm3, areaMm2, { infill = .15, flow = 3 } = {}) {
  const shell = Math.min(volMm3, areaMm2 * 1.1), ext = shell + (volMm3 - shell) * infill, sec = ext / flow * 1.3;
  return { extrudedCm3: +(ext / 1000).toFixed(1), filamentG: Math.round(ext / 1000 * 1.21), hours: +(sec / 3600).toFixed(1) };
}
