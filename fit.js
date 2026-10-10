// Fixifoot demo – scan-accurate fitting (v4)
//  alignScan:        units, PCA + floor (RANSAC), heel/toe, left/right, noise removal -> app frame (mm, y-up, heel +z)
//  rasterizePlantar: 2 mm plantar height map (lower envelope of the scan)
//  deriveModel:      footprint outline, landmarks (heel/ball width, arch apex, ball line, toe gap), CSI
//  buildContactSole: full-length total-contact insole / flip-flop footbed from the map + clinical mods
//  morphTemplate:    non-uniform warp of the Fixifoot L90/S90 templates to the scan + Z conform
//  fitCheck:         rasterises the actual product top surface and measures the gap to the scan (mm)
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { holesTexture, hexTexture, zoneHit, heatColor, insoleShape } from './geometry.js';
import { buildOpenSole, rowSampler, defaultAllow } from './openings.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function pct(arr, q) { const a = Float64Array.from(arr).sort(); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : 0; }

// symmetric 3x3 eigen decomposition (Jacobi). returns [{val, vec}] sorted desc
function eig3(m) {
  const a = [[m[0], m[1], m[2]], [m[1], m[4], m[5]], [m[2], m[5], m[8]]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]); if (off < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return [0, 1, 2].map(i => ({ val: a[i][i], vec: new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize() })).sort((x, y) => y.val - x.val);
}
function covariance(pts) { // pts: array of Vector3
  const c = new THREE.Vector3(); pts.forEach(p => c.add(p)); c.multiplyScalar(1 / pts.length);
  const m = new Array(9).fill(0);
  for (const p of pts) { const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z; m[0] += x * x; m[1] += x * y; m[2] += x * z; m[4] += y * y; m[5] += y * z; m[8] += z * z; }
  return { c, m: m.map(v => v / pts.length) };
}

/* ---------------- 1. alignment ---------------- */
export function alignScan(geoIn, filename = '', nudge = {}) {
  const info = { file: filename, steps: [] };
  let g = new THREE.BufferGeometry(); g.setAttribute('position', geoIn.attributes.position.clone()); if (geoIn.index) g.setIndex(geoIn.index.clone());
  g.computeBoundingBox(); const sz = g.boundingBox.getSize(new THREE.Vector3()), d = Math.max(sz.x, sz.y, sz.z);
  // units: the scale that makes the object a plausible foot (150-1000 mm incl. any leg)
  const cand = [[1000, 'm'], [10, 'cm'], [1, 'mm']];
  let [scale, unit] = cand.find(([s]) => d * s >= 150 && d * s <= 1000) || (d < 1.5 ? cand[0] : d < 60 ? cand[1] : cand[2]);
  if (nudge.unit) [scale, unit] = cand.find(c => c[1] === nudge.unit);
  g.scale(scale, scale, scale); info.units = unit; info.scale = scale; info.rawMaxDim = +d.toFixed(4);
  g = mergeVertices(g, 0.02);
  // keep the largest connected piece (drops floating scan debris)
  const P0 = g.attributes.position, I0 = g.index.array, n0 = P0.count, par = new Int32Array(n0).map((_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let t = 0; t < I0.length; t += 3) { const a = find(I0[t]), b = find(I0[t + 1]), c = find(I0[t + 2]); par[b] = a; par[find(c)] = a; }
  const cnt = new Map(); for (let t = 0; t < I0.length; t += 3) { const r = find(I0[t]); cnt.set(r, (cnt.get(r) || 0) + 1); }
  let best = -1, bestN = 0; cnt.forEach((v, k) => { if (v > bestN) { bestN = v; best = k; } });
  const keepTri = []; for (let t = 0; t < I0.length; t += 3) if (find(I0[t]) === best) keepTri.push(I0[t], I0[t + 1], I0[t + 2]);
  info.removedPieces = cnt.size - 1; info.removedTriangles = I0.length / 3 - keepTri.length / 3;
  // compact
  const remap = new Int32Array(n0).fill(-1), pos = []; let nv = 0; const idx = new Uint32Array(keepTri.length);
  for (let i = 0; i < keepTri.length; i++) { const o = keepTri[i]; if (remap[o] < 0) { remap[o] = nv++; pos.push(P0.getX(o), P0.getY(o), P0.getZ(o)); } idx[i] = remap[o]; }
  const V = []; for (let i = 0; i < nv; i++) V.push(new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
  const step = Math.max(1, Math.floor(V.length / 60000)), S = V.filter((_, i) => i % step === 0);
  const { c: ctr, m } = covariance(S), E = eig3(m);
  // up axis: search the sphere for the direction whose lowest slab covers the largest area (the sole standing on the floor).
  // score = cells within 12 mm of the lowest point + cells within 3 mm (true contact); the peak is sharp, so the best
  // few coarse candidates are refined by hill-climbing before choosing.
  const SS = S.filter((_, i) => i % Math.max(1, Math.floor(S.length / 6000)) === 0), hbuf = new Float32Array(SS.length);
  const slabArea = dv => {
    const t1 = Math.abs(dv.x) < .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), o1 = t1.sub(dv.clone().multiplyScalar(t1.dot(dv))).normalize(), o2 = new THREE.Vector3().crossVectors(dv, o1);
    for (let k = 0; k < SS.length; k++) hbuf[k] = SS[k].dot(dv);
    const hs = Float32Array.from(hbuf).sort(), h0 = hs[Math.floor(hs.length * .003)];
    const c3 = new Set(), c12 = new Set();
    for (let k = 0; k < SS.length; k++) { const h = hbuf[k]; if (h < h0 + 12) { const p = SS[k], key = Math.floor(p.dot(o1) / 5) * 100000 + Math.floor(p.dot(o2) / 5); c12.add(key); if (h < h0 + 3) c3.add(key); } }
    return c12.size + c3.size;
  };
  const climb = (dv, sc) => { for (const stepDeg of [4, 2, 1, .5]) { let improved = true; while (improved) { improved = false; const t1 = Math.abs(dv.x) < .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), o1 = t1.sub(dv.clone().multiplyScalar(t1.dot(dv))).normalize(), o2 = new THREE.Vector3().crossVectors(dv, o1), s = Math.tan(THREE.MathUtils.degToRad(stepDeg));
    for (const [p, q] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const d2 = dv.clone().addScaledVector(o1, p * s).addScaledVector(o2, q * s).normalize(), a2 = slabArea(d2); if (a2 > sc) { sc = a2; dv = d2; improved = true; break; } } } } return [dv, sc]; };
  const NF = 500, coarse = [];
  for (let i = 0; i < NF; i++) { const yy = 1 - 2 * (i + .5) / NF, r = Math.sqrt(1 - yy * yy), th = i * 2.399963; const dv = new THREE.Vector3(r * Math.cos(th), yy, r * Math.sin(th)); coarse.push([dv, slabArea(dv)]); }
  coarse.sort((x, y) => y[1] - x[1]);
  const picked = []; for (const c of coarse) { if (picked.length >= 6) break; if (picked.every(p => p[0].dot(c[0]) < Math.cos(THREE.MathUtils.degToRad(15)))) picked.push(c); }
  let up = null, bestArea = -1; const upCands = [];
  for (const c of picked) { const [dv, sc] = climb(c[0], c[1]); upCands.push([dv, sc]); if (sc > bestArea) { bestArea = sc; up = dv; } }
  upCands.sort((x, y) => y[1] - x[1]); info.upScore = upCands.slice(0, 3).map(c => c[1]);
  // staff nudge: turn 90° about the long axis (if the scan was detected lying on its side)
  if (nudge.turn) { const ax0 = E[0].vec.clone(); up.applyAxisAngle(ax0.sub(up.clone().multiplyScalar(ax0.dot(up))).normalize(), nudge.turn * Math.PI / 2); }
  if (nudge.upside) up.negate();
  // floor plane: RANSAC on the lower envelope (lowest point per 4 mm cell), plane must support the foot from below
  const t1 = new THREE.Vector3(1, 0, 0); if (Math.abs(t1.dot(up)) > .9) t1.set(0, 1, 0);
  const ax = t1.clone().sub(up.clone().multiplyScalar(t1.dot(up))).normalize(), az = new THREE.Vector3().crossVectors(ax, up);
  const env = new Map();
  for (const p of S) { const k = Math.floor(p.dot(ax) / 4) + ',' + Math.floor(p.dot(az) / 4), h = p.dot(up); const e = env.get(k); if (!e || h < e.h) env.set(k, { h, p }); }
  const EPall = [...env.values()].map(e => e.p), hmin0 = pct(EPall.map(p => p.dot(up)), .01), EP = EPall.filter(p => p.dot(up) < hmin0 + 30), R = rng(12345);
  // supporting plane (nothing below it) that is close to as much of the sole as possible: soft contact score
  let bn = up.clone(), bo = hmin0, bscore = -Infinity, bInl = 0;
  const scorePlane = (nn, o) => { let sc = 0, below = 0, inl = 0; for (const p of EP) { const dd = p.dot(nn) - o; if (dd < -1.0) below++; else { sc += Math.exp(-Math.max(0, dd) / 3); if (dd < 1.5) inl++; } } return { sc: below > EP.length * .01 ? -Infinity : sc - 2 * below, inl }; };
  { const s0 = scorePlane(up, hmin0); bscore = s0.sc; bInl = s0.inl; }
  for (let it = 0; it < 1500; it++) {
    const a = EP[Math.floor(R() * EP.length)], b = EP[Math.floor(R() * EP.length)], c = EP[Math.floor(R() * EP.length)];
    const nn = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); if (nn.lengthSq() < 1e-6) continue; nn.normalize();
    if (nn.dot(up) < 0) nn.negate(); if (nn.dot(up) < Math.cos(THREE.MathUtils.degToRad(35))) continue;
    // lower the plane to support the points (tolerating ~0.5% outliers)
    const o = pct(EP.map(p => p.dot(nn)), .005);
    const s = scorePlane(nn, o); if (s.sc > bscore) { bscore = s.sc; bn = nn; bo = o; bInl = s.inl; }
  }
  // least-squares refine on inliers
  // local refinement of the plane normal (hill-climb on the same score)
  for (const stepDeg of [2, 1, .5, .25]) { let improved = true; while (improved) { improved = false; const t1 = Math.abs(bn.x) < .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), o1 = t1.sub(bn.clone().multiplyScalar(t1.dot(bn))).normalize(), o2 = new THREE.Vector3().crossVectors(bn, o1), s = Math.tan(THREE.MathUtils.degToRad(stepDeg));
    for (const [p, q] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nn = bn.clone().addScaledVector(o1, p * s).addScaledVector(o2, q * s).normalize(), o = pct(EP.map(pp => pp.dot(nn)), .005), sc = scorePlane(nn, o); if (sc.sc > bscore + 1e-6) { bscore = sc.sc; bn = nn; bo = o; bInl = sc.inl; improved = true; break; } } } }
  const inl = EP.filter(p => Math.abs(p.dot(bn) - bo) < 1.5);
  info.floorInliers = Math.round(bInl / EP.length * 100); info.tiltCorrectedDeg = +THREE.MathUtils.radToDeg(Math.acos(clamp(bn.dot(up), -1, 1))).toFixed(1);
  const Y = bn.clone();
  // long axis = PCA of the footprint (points < 25 mm above the floor) in the floor plane
  const fx = ax.clone().sub(Y.clone().multiplyScalar(ax.dot(Y))).normalize(), fz = new THREE.Vector3().crossVectors(fx, Y);
  const fp = S.filter(p => p.dot(Y) - bo < 25);
  let sxx = 0, sxz = 0, szz = 0, mx = 0, mz = 0; fp.forEach(p => { mx += p.dot(fx); mz += p.dot(fz); }); mx /= fp.length; mz /= fp.length;
  fp.forEach(p => { const a = p.dot(fx) - mx, b = p.dot(fz) - mz; sxx += a * a; sxz += a * b; szz += b * b; });
  const ang = 0.5 * Math.atan2(2 * sxz, szz - sxx);  // angle of principal axis measured from fz towards fx
  let Z = fz.clone().multiplyScalar(Math.cos(ang)).add(fx.clone().multiplyScalar(Math.sin(ang))).normalize();
  // heel vs toe: ankle/leg mass sits over the heel; otherwise the forefoot is the wider end
  const high = S.filter(p => p.dot(Y) - bo > 55);
  let method;
  if (high.length > S.length * 0.02) { const hz = high.reduce((s, p) => s + p.dot(Z), 0) / high.length, fzm = fp.reduce((s, p) => s + p.dot(Z), 0) / fp.length; if (hz < fzm) Z.negate(); method = 'ankle above heel'; }
  else {
    const X0 = new THREE.Vector3().crossVectors(Y, Z), t = fp.map(p => p.dot(Z)), tmin = Math.min(...t), tmax = Math.max(...t), wAt = (a, b) => { const xs = fp.filter((p, k) => { const f = (t[k] - tmin) / (tmax - tmin); return f >= a && f <= b; }).map(p => p.dot(X0)); return xs.length ? pct(xs, .98) - pct(xs, .02) : 0; };
    if (wAt(.70, .85) > wAt(.15, .30)) Z.negate(); // wider end at high t = toes -> want heel at +Z
    method = 'forefoot wider than heel';
  }
  if (nudge.swapEnds) Z.negate();
  info.heelToeMethod = method + (nudge.swapEnds ? ' (staff swapped)' : '');
  let X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  // optional fine nudges (degrees): yaw about Y, pitch about X, roll about Z
  const rot = new THREE.Matrix4().makeBasis(X, Y, Z).transpose(); // world -> frame
  const nud = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(nudge.pitch || 0), THREE.MathUtils.degToRad(nudge.yaw || 0), THREE.MathUtils.degToRad(nudge.roll || 0), 'YXZ'));
  const M = new THREE.Matrix4().multiplyMatrices(nud, rot);
  const arr = new Float32Array(nv * 3), v = new THREE.Vector3();
  for (let i = 0; i < nv; i++) { v.copy(V[i]).applyMatrix4(M); arr[3 * i] = nudge.mirror ? -v.x : v.x; arr[3 * i + 1] = v.y; arr[3 * i + 2] = v.z; }
  // floor at y = 0: contacts of the refined plane (median of the inlier heights in the new frame)
  let yOff;
  if (nudge.pitch || nudge.roll) { const ys = []; for (let i = 0; i < nv; i++) ys.push(arr[3 * i + 1]); yOff = pct(ys, 0.003); }
  else { const tmp = new THREE.Vector3(); yOff = pct(inl.map(p => tmp.copy(p).applyMatrix4(M).y), 0.5); }
  // centre: footprint x mid = 0, heel at z = +L/2
  let xmn = Infinity, xmx = -Infinity, zmn = Infinity, zmx = -Infinity;
  for (let i = 0; i < nv; i++) { arr[3 * i + 1] -= yOff; if (arr[3 * i + 1] < 40) { xmn = Math.min(xmn, arr[3 * i]); xmx = Math.max(xmx, arr[3 * i]); zmn = Math.min(zmn, arr[3 * i + 2]); zmx = Math.max(zmx, arr[3 * i + 2]); } }
  const cx = (xmn + xmx) / 2, cz = (zmn + zmx) / 2;
  let below = 0; for (let i = 0; i < nv; i++) { arr[3 * i] -= cx; arr[3 * i + 2] -= cz; if (arr[3 * i + 1] < -1.5) below++; }
  info.pointsBelowFloor = below;
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  out.setIndex(new THREE.BufferAttribute(nudge.mirror ? flipIdx(idx) : idx, 1)); out.computeVertexNormals();
  let maxY = 0; for (let i = 0; i < nv; i++) maxY = Math.max(maxY, arr[3 * i + 1]);
  info.heightMm = Math.round(maxY); info.trimAboveMm = 40; info.triangles = idx.length / 3;
  const model = deriveModel(rasterizePlantar(out));
  info.side = model.side; info.sideMethod = model.sideMethod + (nudge.mirror ? ' (staff mirrored)' : '');
  return { geo: out, info, model };
}
function flipIdx(idx) { const o = idx.slice(); for (let i = 0; i < o.length; i += 3) { const t = o[i + 1]; o[i + 1] = o[i + 2]; o[i + 2] = t; } return o; }

/* ---------------- 2. plantar height map ---------------- */
// lower envelope of all triangles that reach below `maxH` (default 45 mm: ankle/leg above ~40 mm is ignored)
export function rasterizePlantar(geo, res = 2, maxH = 45) {
  const P = geo.attributes.position, I = geo.index ? geo.index.array : null, nt = I ? I.length / 3 : P.count / 3;
  let xmn = Infinity, xmx = -Infinity, zmn = Infinity, zmx = -Infinity;
  for (let i = 0; i < P.count; i++) if (P.getY(i) < maxH) { xmn = Math.min(xmn, P.getX(i)); xmx = Math.max(xmx, P.getX(i)); zmn = Math.min(zmn, P.getZ(i)); zmx = Math.max(zmx, P.getZ(i)); }
  const M = 16, x0 = Math.floor((xmn - M) / res) * res, z0 = Math.floor((zmn - M) / res) * res;
  const nx = Math.ceil((xmx + M - x0) / res), nz = Math.ceil((zmx + M - z0) / res), raw = new Float32Array(nx * nz).fill(Infinity);
  // heights only from the sole itself (surfaces flatter than ~65°): steep side walls of the foot would otherwise lift the rim of the map
  rasterTris(P, I, nt, { x0, z0, res, nx, nz }, raw, 'min', t => t.minY < maxH && Math.abs(t.ny) / (t.nl || 1) > 0.42);
  // outline (silhouette) = everything below 20 mm, used for the insole outline
  const silH = new Float32Array(nx * nz).fill(Infinity); rasterTris(P, I, nt, { x0, z0, res, nx, nz }, silH, 'min', t => t.minY < 20);
  const sil = new Uint8Array(nx * nz); for (let k = 0; k < raw.length; k++) { if (!isFinite(raw[k])) raw[k] = NaN; sil[k] = isFinite(silH[k]) || !isNaN(raw[k]) ? 1 : 0; }
  return { res, x0, z0, nx, nz, raw, sil };
}
// rasterise triangles onto the grid at cell centres (min or max of the interpolated height)
function rasterTris(P, I, nt, G, out, mode, accept) {
  const { x0, z0, res, nx, nz } = G, A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const ia = I ? I[3 * t] : 3 * t, ib = I ? I[3 * t + 1] : 3 * t + 1, ic = I ? I[3 * t + 2] : 3 * t + 2;
    A[0] = P.getX(ia); A[1] = P.getY(ia); A[2] = P.getZ(ia); B[0] = P.getX(ib); B[1] = P.getY(ib); B[2] = P.getZ(ib); C[0] = P.getX(ic); C[1] = P.getY(ic); C[2] = P.getZ(ic);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2], nX = uy * vz - uz * vy, nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx;
    const tri = { minY: Math.min(A[1], B[1], C[1]), ny: nY, nl: Math.hypot(nX, nY, nZ), A, B, C };
    if (accept && !accept(tri)) continue;
    const det = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]); if (Math.abs(det) < 1e-9) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(A[0], B[0], C[0]) - x0) / res - 0.5)), i1 = Math.min(nx - 1, Math.floor((Math.max(A[0], B[0], C[0]) - x0) / res - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(A[2], B[2], C[2]) - z0) / res - 0.5)), j1 = Math.min(nz - 1, Math.floor((Math.max(A[2], B[2], C[2]) - z0) / res - 0.5));
    for (let j = j0; j <= j1; j++) { const pz = z0 + (j + .5) * res; for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + .5) * res, l1 = ((B[2] - C[2]) * (px - C[0]) + (C[0] - B[0]) * (pz - C[2])) / det, l2 = ((C[2] - A[2]) * (px - C[0]) + (A[0] - C[0]) * (pz - C[2])) / det, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * A[1] + l2 * B[1] + l3 * C[1], k = j * nx + i;
      if (mode === 'min' ? y < out[k] : y > out[k]) out[k] = y;
    } }
  }
}

/* ---------------- footprint, landmarks, smoothed surface ---------------- */
export function deriveModel(grid) {
  const { res, x0, z0, nx, nz, raw } = grid, at = (i, j) => raw[j * nx + i];
  // smoothed + extended plantar surface (fills toe gaps and the margin around the foot)
  let S = Float32Array.from(raw);
  for (let pass = 0; pass < 60; pass++) {
    const T = Float32Array.from(S); let changed = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!isNaN(S[k])) continue; let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const v = S[jj * nx + ii]; if (!isNaN(v)) { s += v; c++; } }
      if (c >= (pass < 6 ? 3 : 1)) { T[k] = s / c; changed++; } }
    S = T; if (!changed && pass > 6) break;
  }
  for (let k = 0; k < S.length; k++) if (isNaN(S[k])) S[k] = 0;
  for (let pass = 0; pass < 1; pass++) { const T = new Float32Array(S.length);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0, w = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = clamp(i + di, 0, nx - 1), jj = clamp(j + dj, 0, nz - 1), ww = (di ? 1 : 2) * (dj ? 1 : 2); s += S[jj * nx + ii] * ww; w += ww; } T[j * nx + i] = s / w; }
    S = T; }
  // footprint rows
  let jT = -1, jH = -1; const xLo = new Float32Array(nz).fill(NaN), xHi = new Float32Array(nz).fill(NaN);
  const inS = (i, j) => (grid.sil ? grid.sil[j * nx + i] === 1 : !isNaN(at(i, j)));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (inS(i, j)) { if (jT < 0) jT = j; jH = j; const x = x0 + (i + .5) * res; xLo[j] = isNaN(xLo[j]) ? x - res / 2 : Math.min(xLo[j], x - res / 2); xHi[j] = isNaN(xHi[j]) ? x + res / 2 : Math.max(xHi[j], x + res / 2); }
  const zToe = z0 + jT * res, zHeel = z0 + (jH + 1) * res, L = zHeel - zToe, uOfZ = z => (zHeel - z) / L, zOfU = u => zHeel - u * L;
  // outline: closing over +-4 rows (bridges toe gaps / scan holes) then a wide smoothing window -> a clean insole outline
  const close = (a, f) => { const o = Float32Array.from(a); for (let j = 0; j < nz; j++) { if (isNaN(a[j])) continue; let v = a[j]; for (let d = -4; d <= 4; d++) { const w = a[j + d]; if (w !== undefined && !isNaN(w)) v = f(v, w); } o[j] = v; } return o; };
  const sm = (a, R = 5) => { const o = Float32Array.from(a); for (let j = 0; j < nz; j++) { let s = 0, c = 0; for (let d = -R; d <= R; d++) { const v = a[j + d]; const w = 1 - Math.abs(d) / (R + 1); if (v !== undefined && !isNaN(v)) { s += v * w; c += w; } } o[j] = isNaN(a[j]) ? NaN : s / c; } return o; };
  const xL = sm(close(xLo, Math.min)), xH = sm(close(xHi, Math.max));
  const rowAt = z => { const j = clamp(Math.round((z - z0) / res - .5), jT, jH); return { lo: xL[j], hi: xH[j] }; };
  const width = u => { const r = rowAt(zOfU(u)); return r.hi - r.lo; };
  let ballW = 0, ballU = .7, heelW = 0;
  for (let u = .55; u <= .82; u += .005) { const w = width(u); if (w > ballW) { ballW = w; ballU = u; } }
  for (let u = .05; u <= .25; u += .005) heelW = Math.max(heelW, width(u));
  // medial side: higher plantar surface in the midfoot (arch); fallback: the longest toe is medial
  let pos = 0, pc = 0, neg = 0, ncnt = 0;
  for (let j = jT; j <= jH; j++) { const u = uOfZ(z0 + (j + .5) * res); if (u < .35 || u > .55) continue; const c = (xL[j] + xH[j]) / 2, hw = (xH[j] - xL[j]) / 2;
    for (let i = 0; i < nx; i++) { const v = at(i, j); if (isNaN(v)) continue; const sx = (x0 + (i + .5) * res - c) / hw; if (sx > .3) { pos += v; pc++; } else if (sx < -.3) { neg += v; ncnt++; } } }
  const archDiff = (pos / (pc || 1)) - (neg / (ncnt || 1));
  let medialX, sideMethod;
  const rb = rowAt(zOfU(ballU)), cBall = (rb.lo + rb.hi) / 2;
  let tipX = 0; { let s = 0, c = 0; for (let jj = jT; jj <= jT + 1; jj++) for (let i = 0; i < nx; i++) if (!isNaN(at(i, jj))) { s += x0 + (i + .5) * res; c++; } tipX = c ? s / c : cBall; }
  if (Math.abs(archDiff) > 1.0) { medialX = Math.sign(archDiff); sideMethod = `arch side higher by ${Math.abs(archDiff).toFixed(1)} mm`; }
  else { medialX = Math.sign(tipX - cBall) || -1; sideMethod = 'longest toe is on the inside (flat arch)'; }
  const side = medialX < 0 ? 'R' : 'L';
  // arch apex (highest plantar point on the medial half, 25-60 % of length)
  let archH = 0, archU = .41;
  for (let j = jT; j <= jH; j++) { const z = z0 + (j + .5) * res, u = uOfZ(z); if (u < .25 || u > .6) continue; const c = (xL[j] + xH[j]) / 2, hw = (xH[j] - xL[j]) / 2;
    for (let i = 0; i < nx; i++) { const v = at(i, j); if (isNaN(v)) continue; const sn = medialX * (x0 + (i + .5) * res - c) / hw; if (sn > .2 && sn < .85 && v > archH && v < 40) { archH = v; archU = u; } } }
  // Chippaux-Smirak index from the contact print (plantar height <= 5 mm: a non-weight-bearing scan, soft tissue flattens when standing)
  const contactW = u => { const j = clamp(Math.round((zOfU(u) - z0) / res - .5), 0, nz - 1); let c = 0; for (let i = 0; i < nx; i++) { const v = at(i, j); if (!isNaN(v) && v <= 5) c++; } return c * res; };
  let fore = 0, mid = Infinity; for (let u = .6; u <= .8; u += .01) fore = Math.max(fore, contactW(u)); for (let u = .4; u <= .55; u += .01) mid = Math.min(mid, contactW(u));
  const csi = fore ? Math.round(mid / fore * 100) : 35;
  // toe gap (1st/2nd toe): dip in the distal toe profile next to the longest medial toe
  const prof = []; for (let i = 0; i < nx; i++) { let zm = NaN; for (let j = jT; j <= jH; j++) { if (uOfZ(z0 + (j + .5) * res) < .8) break; if (!isNaN(at(i, j))) { zm = z0 + (j + .5) * res; break; } } prof.push(zm); }
  const cols = [...Array(nx).keys()].filter(i => !isNaN(prof[i])).sort((a, b) => medialX > 0 ? b - a : a - b); // medial -> lateral
  let toeGap = null;
  if (cols.length > 6) {
    let hk = 0; for (let k = 0; k < Math.min(cols.length, Math.ceil(cols.length * .45)); k++) if (prof[cols[k]] < prof[cols[hk]]) hk = k;
    let dip = hk; for (let k = hk + 1; k < Math.min(cols.length, hk + 14); k++) { if (prof[cols[k]] > prof[cols[dip]]) dip = k; else if (prof[cols[k]] < prof[cols[dip]] - 3) break; }
    if (dip > hk && prof[cols[dip]] - prof[cols[hk]] >= 2) toeGap = { x: x0 + (cols[dip] + .5) * res, z: prof[cols[dip]] + 4, detected: true };
  }
  if (!toeGap) toeGap = { x: cBall + medialX * 0.2 * ballW, z: zOfU(.88), detected: false };
  const sulcusU = clamp(uOfZ(toeGap.z), .76, .9);
  const sampleS = (x, z) => { // bilinear on the smoothed/extended surface
    const fi = clamp((x - x0) / res - .5, 0, nx - 1.001), fj = clamp((z - z0) / res - .5, 0, nz - 1.001), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
    return (S[j * nx + i] * (1 - a) + S[j * nx + i + 1] * a) * (1 - b) + (S[(j + 1) * nx + i] * (1 - a) + S[(j + 1) * nx + i + 1] * a) * b;
  };
  // v6.1 smooth forefoot: no copied toe ridges. Robust (lower-envelope weighted) quadratic fit of the plantar surface from just
  // behind the metatarsal heads to the toe tips -> a template-like surface with gentle toe spring, blended into the scan over ~18 mm.
  const hwB = Math.max(10, ballW / 2), tOf = z => uOfZ(z) - ballU, rB = rowAt(zOfU(ballU)), cB = (rB.lo + rB.hi) / 2;
  // fixed (ball-row) centre and half-width -> the fit is a true low-order polynomial in x,z (no per-row outline wobble near the toe tip)
  const sOf = (x, z) => medialX * (x - cB) / hwB, inRow = (x, z) => { const r = rowAt(z), c = (r.lo + r.hi) / 2, hw = Math.max(8, (r.hi - r.lo) / 2); return Math.abs(x - c) / hw; };
  const basis = (t, sx) => [1, t, t * t, sx, sx * sx, sx * t];
  const samp = [];
  for (let j = jT; j <= jH; j++) { const z = z0 + (j + .5) * res, t = tOf(z); if (t < -.06) continue;
    for (let i = 0; i < nx; i++) { const v = at(i, j); if (isNaN(v) || v > 25) continue; const xx = x0 + (i + .5) * res; if (inRow(xx, z) > .85) continue; const sx = sOf(xx, z); samp.push([basis(t, sx), v]); } }
  let coef = null;
  const solve = (A, b) => { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
  if (samp.length > 30) {
    let w = samp.map(() => 1);
    for (let it = 0; it < 6; it++) {
      const A = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
      samp.forEach(([f, v], k) => { for (let a = 0; a < 6; a++) { b[a] += w[k] * f[a] * v; for (let c = 0; c < 6; c++) A[a][c] += w[k] * f[a] * f[c]; } });
      for (let a = 1; a < 6; a++) A[a][a] += 1e-3 * samp.length; // light ridge regularisation -> no wild curvature
      const cNew = solve(A, b); if (!cNew) break; coef = cNew;
      // asymmetric robust weights: points far ABOVE the surface (gaps between toes, toe sides) count little -> follows the toe pads
      w = samp.map(([f, v]) => { const r = v - f.reduce((s, x, i) => s + x * coef[i], 0); return r > 0 ? 1 / (1 + (r / 1.0) ** 2) : 1 / (1 + (r / 3.0) ** 2); });
    }
  }
  const softZero = q => q > 1 ? q : q < -1 ? 0 : .25 * (q + 1) ** 2;
  const foreQ = (x, z) => { if (!coef) return null; const t = Math.max(tOf(z), -.08), f = basis(t, clamp(sOf(x, z), -1.6, 1.6)); return softZero(f.reduce((s, v, i) => s + v * coef[i], 0)); };
  const fB0 = ballU - 14 / L, fB1 = ballU + 4 / L; // blend window (~18 mm) ending just in front of the met-head line
  const sampleF = (x, z) => { const ps = sampleS(x, z), q = foreQ(x, z); if (q == null) return ps; const wq = smooth(fB0, fB1, uOfZ(z)); return wq <= 0 ? ps : ps * (1 - wq) + q * wq; };
  return { grid, S, sampleF, foreCoef: coef, foreBlend: [fB0, fB1], L: Math.round(L * 10) / 10, W: Math.round(ballW * 10) / 10, heelW: Math.round(heelW * 10) / 10, ballU, archU, archH: Math.round(archH * 10) / 10, archCap: archH + 2, csi, medialX, side, sideMethod, zHeel, zToe, rowAt, uOfZ, zOfU, sampleS, toeGap, sulcusU };
}
export function encodeGrid(gr) { const q = new Int16Array(gr.raw.length); for (let k = 0; k < q.length; k++) q[k] = isNaN(gr.raw[k]) ? (gr.sil && gr.sil[k] ? -32767 : -32768) : Math.round(gr.raw[k] * 10); let s = ''; const u = new Uint8Array(q.buffer); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return { res: gr.res, x0: gr.x0, z0: gr.z0, nx: gr.nx, nz: gr.nz, q: btoa(s) }; }
export function decodeGrid(e) { const s = atob(e.q), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); const q = new Int16Array(u.buffer), raw = new Float32Array(q.length), sil = new Uint8Array(q.length); for (let k = 0; k < q.length; k++) { raw[k] = q[k] <= -32767 ? NaN : q[k] / 10; sil[k] = q[k] === -32768 ? 0 : 1; } return { res: e.res, x0: e.x0, z0: e.z0, nx: e.nx, nz: e.nz, raw, sil }; }

/* ---------------- 3. total-contact insole / footbed ---------------- */
export const ALLOW = { insole: { side: 1.5, heel: 1, toe: 6 }, flipflop: { side: 6, heel: 5, toe: 8 }, slide: { side: 6, heel: 5, toe: 8 }, sandal: { side: 6, heel: 5, toe: 12 }, clog: { side: 5, heel: 6, toe: 7 } }; // v13: two-strap sandal / clog
// clinical modifications on top of the scanned surface; u = foot length fraction (0 heel, 1 toe tip), sn = +1 medial
function mods(md, p, u, sn, hw) {
  let z = 0; const rad = Math.PI / 180, L = md.L;
  const heelFade = 1 - smooth(.25, .42, u);
  z += p.heelLift * (1 - smooth(.28, .55, u));
  if (p.archBoost) z += p.archBoost * gauss(u, md.archU, .1) * smooth(-0.2, 0.6, sn); // v12 orthotist: extra medial arch support
  z += Math.tan(p.medialPost * rad) * hw * (sn + 1) * 0.5 * heelFade;
  z += Math.tan(p.medialHeelSkive * rad) * hw * Math.max(0, sn) * heelFade * 0.6;
  z += Math.tan(p.lateralWedge * rad) * hw * (1 - sn) * 0.5 * (1 - smooth(.75, .95, u));
  const padU = md.ballU - 15 / L; // dome apex ~15 mm behind the met-head line -> front edge ~6-11 mm behind it
  if (p.metPad) { const cs = p.metPad === 'neuroma' ? -.22 : 0.05; z += 4.5 * Math.exp(-(((u - padU) / (10 / L)) ** 2 + ((sn - cs) / .28) ** 2)); }
  if (p.toeCrest) z += (p.toeCrestMm || 4) * gauss(u, md.sulcusU - .012, .02) * (1 - smooth(.45, .8, Math.abs(sn + .08)));
  if (p.mortonExtension) z += 1.5 * smooth(md.ballU - .04, md.ballU, u) * smooth(.25, .45, sn);
  const ell = (cu, cs, ru, rs) => 1 - smooth(.7, 1, Math.hypot((u - cu) / ru, (sn - cs) / rs));
  let dep = 0;
  if (p.heelCutout || p.offloadPockets) dep = Math.max(dep, 1.5 * ell(.12, 0, .06, .38));
  if (p.sesamoidCutout) dep = Math.max(dep, 1.5 * ell(md.ballU + .01, .58, .04, .22));
  if (p.offloadPockets) dep = Math.max(dep, 1.1 * ell(md.ballU + .02, 0, .045, .7));
  if (p.firstMTPRelief) dep = Math.max(dep, 1.0 * ell(md.ballU + .03, .75, .06, .3));
  return z - dep;
}
// zones where the insole deliberately differs from the foot (excluded from the contact-accuracy number)
export function modZoneTest(md, p) {
  const L = md.L, padU = md.ballU - 15 / L, tests = [];
  if (p.metPad) tests.push(['Metatarsal pad', (u, sn) => Math.hypot((u - padU) / (16 / L), (sn - (p.metPad === 'neuroma' ? -.22 : .05)) / .45) < 1]);
  if (p.heelLift) tests.push(['Heel lift', u => u < .58]);
  if (p.medialPost || p.medialHeelSkive) tests.push(['Medial heel post', (u, sn) => u < .45 && sn > -.2]);
  if (p.lateralWedge) tests.push(['Lateral wedge', (u, sn) => sn < .2]);
  if ((p.archFill ?? 100) < 100) tests.push([`Arch fill ${p.archFill}%`, (u, sn) => Math.abs(u - .41) < .2 && sn > -.1]);
  tests.push(['Smooth forefoot (no toe ridges)', u => u > md.ballU - 4 / L]);
  if (p.heelCupDepth > 14) tests.push([`Deep heel cup ${p.heelCupDepth} mm`, u => u < .14]);
  if (p.archBoost) tests.push([`Arch support +${p.archBoost} mm (orthotist)`, (u, sn) => Math.abs(u - md.archU) < .2 && sn > -.2]);
  if (p._model?.archBoost) tests.push([`Arch support +${p._model.archBoost} mm (model)`, (u, sn) => Math.abs(u - md.archU) < .2 && sn > -.2]);
  if (p.toeCrest) tests.push(['Toe crest', u => Math.abs(u - (md.sulcusU - .012)) < .05]);
  if (p.mortonExtension) tests.push(["Morton's extension", (u, sn) => u > md.ballU - .06 && sn > .2]);
  if (p.heelCutout || p.offloadPockets) tests.push(['Heel offload pocket', (u, sn) => Math.hypot((u - .12) / .08, sn / .5) < 1]);
  if (p.offloadPockets) tests.push(['Forefoot offload pocket', (u, sn) => Math.abs(u - md.ballU - .02) < .07]);
  if (p.sesamoidCutout || p.firstMTPRelief) tests.push(['Big-toe joint relief', (u, sn) => Math.abs(u - md.ballU - .02) < .08 && sn > .3]);
  return tests;
}
// v7 model extras: strong-arch boost and smooth-edged soft-insert pockets (diabetic met heads / hallux)
export const RECESS_AT = { met: md => ({ cu: md.ballU + .005, cs: 0, ru: .045, rs: .72 }), hallux: md => ({ cu: Math.min(md.ballU + .125, .95), cs: .5, ru: .045, rs: .32 }), heel: () => ({ cu: .12, cs: 0, ru: .07, rs: .45 }) };
function modelExtra(md, M, u, sn) {
  let z = 0;
  if (M.archBoost) z += M.archBoost * gauss(u, md.archU, .1) * smooth(-0.2, 0.8, sn);
  for (const r of M.recesses || []) { const e = RECESS_AT[r.at](md); z -= r.depth * (1 - smooth(.55, 1, Math.hypot((u - e.cu) / e.ru, (sn - e.cs) / e.rs))); }
  return z;
}
function insoleFrame(md, kind, lastLen, frontU = null) {
  const a = ALLOW[kind] || ALLOW.insole;
  let toe = a.toe; if (lastLen) toe = Math.max(2, lastLen - md.L - a.heel);
  const zBack = md.zHeel + a.heel, zFront = frontU != null ? md.zOfU(frontU) : md.zToe - toe, Li = zBack - zFront; // v7: 3/4 length ends at frontU
  // v8.2: clean, fair insole outline instead of the raw (smoothed) scan silhouette. The canonical insole-last shape
  // (geometry.insoleShape) is laid on a straight axis through the scanned heel centre and ball centre, scaled to the scanned
  // ball width (+ side allowance) and, in the rearfoot, to the scanned heel width. Ball row of the shape = scanned ball line.
  const zB = md.zOfU(md.ballU), rbB = md.rowAt(zB), rbH = md.rowAt(md.zOfU(.15)), cBx = (rbB.lo + rbB.hi) / 2, cHx = (rbH.lo + rbH.hi) / 2;
  const zH = md.zOfU(.15), axisX = z => cHx + (cBx - cHx) * (z - zH) / ((zB - zH) || 1);
  const zEnd = md.zToe - (frontU != null ? (lastLen ? Math.max(2, lastLen - md.L - a.heel) : a.toe) : toe), LiF = zBack - zEnd; // full-length insole (3/4 = truncated copy)
  const Wb = md.W + 2 * a.side, uBall = clamp((zBack - zB) / LiF, .55, .85);
  const heelK = clamp((md.heelW + 2 * a.side) / (.72 * Wb), .85, 1.15);
  const Rf = .28 * Wb;
  const edge = ui => { // lateral/medial x of the outline at insole-u (0 = heel end, 1 = front end of THIS insole)
    const z = zBack - ui * Li, uf = (zBack - z) / LiF, q = insoleShape(uf, uBall), k = Wb * (heelK + (1 - heelK) * smooth(.22, .55, uf));
    let mm = q.m * k, ll = q.l * k;
    if (frontU != null) { const dF = z - zFront; if (dF < Rf) { const f = Math.sqrt(Math.max(0, 1 - ((Rf - dF) / Rf) ** 2)), cc = (mm - ll) / 2; mm = cc + (mm - cc) * f; ll = -cc + (ll + cc) * f; } } // 3/4: rounded front corners
    let half = Math.max((mm + ll) / 2, 1.5);
    const c = axisX(z) + md.medialX * (mm - ll) / 2;
    return { c, half, xM: c + md.medialX * half, xL: c - md.medialX * half, z };
  };
  return { zBack, zFront, Li, edge, allow: { ...a, toe } };
}
export function buildContactSole(md, opts) {
  const { params: p, kind = 'insole', zones = [], showZones = true, highlight = null, color = '#ffffff', uvMode = 'none', lastLen = null, openings = null } = opts;
  const M = kind === 'insole' ? p._model : null; // v7 insole line geometry (thickness profile, length, arch boost, soft pockets, rim)
  const sc = M?.scaleWithSize ? clamp(md.L / 240, .75, 1) : 1;
  const frontU = M?.length === '3/4' ? md.ballU + (M.frontMm ?? 6) / md.L : null;
  const NU = 170, NV = 48, F = insoleFrame(md, kind, lastLen, frontU);
  const base = new THREE.Color(color), tmp = new THREE.Color(), dark = base.clone().multiplyScalar(kind === 'insole' ? 0.92 : 0.78);
  const thick0 = kind === 'insole' ? (p._thick || 2.6) : kind === 'flipflop' ? 11 : 13;
  const fill = (p.archFill ?? 100) / 100;
  const rows = [];
  for (let i = 0; i < NU; i++) {
    const t = i / (NU - 1), ui = 0.5 - 0.5 * Math.cos(Math.PI * t), e = F.edge(ui), u = md.uOfZ(e.z), row = [];
    // thickness varies LINEARLY heel -> toe (thicker heel, thinner forefoot / heel drop): a pure pitch the foot follows rigidly, so contact is kept
    let th = thick0; if (M) th = Math.max(1.6, sc * (M.heelT + (M.foreT - M.heelT) * clamp(u, 0, 1))); else if (kind === 'insole') th = Math.max(1.6, th * (1.15 - 0.45 * clamp(u, 0, 1))); else th += 5 * (1 - clamp(u, 0, 1));
    if (frontU != null) th = Math.max(1.3, th * (1 - .4 * smooth(.88, 1, ui))); // 3/4: skived front edge
    if (p.minThick) th = Math.max(th, p.minThick);
    for (let j = 0; j < NV; j++) {
      const sn = -1 + 2 * j / (NV - 1), x = e.c + md.medialX * sn * (p._notch ? Math.max(1.5, e.half - p._notch(e.z)) : e.half); // v13: strap notches (two-strap sandal)
      // plantar height capped just above the measured arch apex: at the outline the lower envelope climbs the side of the foot, the insole must not
      const P = Math.min(md.sampleF(x, e.z), md.archCap) * (1 - (1 - fill) * gauss(u, .41, .12) * smooth(-0.2, 0.6, sn));
      // heel cup wall rises from the SCANNED heel contour (foot-relative position sf = 1 at the footprint edge)
      const rf = md.rowAt(e.z), fh = Math.max(4, (rf.hi - rf.lo) / 2), sf = (x - (rf.lo + rf.hi) / 2) * md.medialX / fh;
      const cup = p.heelCupDepth * smooth(.93, 1.05, Math.hypot(Math.max(0, (.12 - u) / .12), sf)) * (1 - smooth(.22, .38, u));
      const flange = p.lateralFlange ? 7 * smooth(.68, 1, -sn) * smooth(.02, .1, u) * (1 - smooth(.52, .68, u)) : 0;
      // v13.2 footwear: raised rim outside the scanned footprint (sides + toe) – never under the foot
      const dEdge = Math.min((1 - Math.abs(sn)) * e.half, Math.max(0, e.z - F.zFront) + 99 * (1 - smooth(.9, .95, u))), rim = p.shoeRim ? p.shoeRim * (1 - smooth(2.5, 8, dEdge)) * smooth(.24, .36, u) : 0;
      let top = th + Math.max(P, cup, flange) + mods(md, p, u, sn, e.half) + rim;
      if (M) top += modelExtra(md, M, u, sn);
      top -= smooth(.86, 1, Math.abs(sn)) * (M ? M.rim : p.noHardEdges ? 1.2 : 0.5) * (kind === 'insole' ? 1 : .6); // rounded rim
      if (frontU != null) top -= 0.6 * smooth(.9, 1, ui); // 3/4 front edge blends down
      // v13.2 footwear: light tread = shallow chevron grooves in the bottom face (bridged by the first layers, visible as notches round the edge)
      let bz = 0; if (p.tread) { const w = Math.abs(((e.z + .45 * Math.abs(x - e.c)) / 9 % 1 + 1) % 1 - .5) * 9; bz = p.tread * (1 - smooth(1.1, 2.0, w)); }
      row.push({ u, ui, sn, x, z: e.z, tz: Math.max(M ? 1.2 : 1.0, top), bz });
    }
    rows.push(row);
  }
  const mesh = gridSoleMesh(rows, NU, NV, { base, tmp, dark, zones, showZones, highlight, kind, uvMode, medialX: md.medialX });
  let openStats = null;
  if (openings) { // v6: real holes / lattice cut into the scan-based sole (preview == STL)
    const zs = [...zones].sort((a, b) => (b.rect ? (b.rect.u[1] - b.rect.u[0]) * (b.rect.s[1] - b.rect.s[0]) : Math.PI * b.ellipse.ru * b.ellipse.rs) - (a.rect ? (a.rect.u[1] - a.rect.u[0]) * (a.rect.s[1] - a.rect.s[0]) : Math.PI * a.ellipse.ru * a.ellipse.rs));
    const colorAt = (u, sn) => { const c = base.clone(); if (showZones) for (const z of zs) if ((z.id !== 'fullLength' || (highlight && highlight.includes('fullLength'))) && zoneHit(z, u, sn)) c.copy(base).lerp(new THREE.Color(z.color), highlight ? (highlight.includes(z.id) ? 0.85 : 0.08) : 0.42); return c; };
    const res = buildOpenSole(rowSampler(rows, 'z'), { ...openings, allow: openings.allow || defaultAllow(openings.mode, p, md.ballU), colorAt, dark });
    const common = { vertexColors: true, roughness: kind === 'insole' ? 0.55 : 0.75, metalness: 0, side: THREE.DoubleSide };
    mesh.geometry.dispose(); mesh.geometry = res.geometry; mesh.material = [0, 1, 2].map(() => new THREE.MeshStandardMaterial(common)); openStats = res.stats;
  }
  // landmarks for flip-flop straps
  const S = (ui, sn) => { const i = Math.round((Math.acos(1 - 2 * clamp(ui, 0, 1)) / Math.PI) * (NU - 1)), j = Math.round((sn + 1) / 2 * (NV - 1)); const v = rows[clamp(i, 0, NU - 1)][clamp(j, 0, NV - 1)]; return new THREE.Vector3(v.x, v.tz, v.z); };
  const uiOfFootU = u => (F.zBack - md.zOfU(u)) / F.Li;
  const topAtXZ = (x, z) => { let best = null, bd = Infinity; const ui = (F.zBack - z) / F.Li, i = Math.round((Math.acos(1 - 2 * clamp(ui, 0, 1)) / Math.PI) * (NU - 1)); for (const row of rows.slice(Math.max(0, i - 2), i + 3)) for (const v of row) { const dd = (v.x - x) ** 2 + (v.z - z) ** 2; if (dd < bd) { bd = dd; best = v; } } return new THREE.Vector3(x, best.tz, z); };
  const post = topAtXZ(md.toeGap.x, md.toeGap.z + 4), uStrap = md.ballU - .1;
  mesh.userData = { rows, lenKey: 'z', surfaceAt: S, kind, frame: F, anchors: { post, endM: S(uiOfFootU(uStrap), 1), endL: S(uiOfFootU(uStrap), -1), midM: S(uiOfFootU(uStrap + .1), .8), midL: S(uiOfFootU(uStrap + .1), -.8) }, contact: true, openings: openStats };
  return mesh;
}
function gridSoleMesh(rows, NU, NV, o) {
  const mk = () => ({ pos: [], col: [], uv: [], idx: [] }), top = mk(), bot = mk(), wall = mk();
  const zs = [...o.zones].sort((a, b) => (b.rect ? (b.rect.u[1] - b.rect.u[0]) * (b.rect.s[1] - b.rect.s[0]) : Math.PI * b.ellipse.ru * b.ellipse.rs) - (a.rect ? (a.rect.u[1] - a.rect.u[0]) * (a.rect.s[1] - a.rect.s[0]) : Math.PI * a.ellipse.ru * a.ellipse.rs));
  const push = (g, x, y, z, c, uu, vv) => { g.pos.push(x, y, z); g.col.push(c.r, c.g, c.b); g.uv.push(uu, vv); };
  const topColor = (u, sn) => { o.tmp.copy(o.base); if (o.showZones) for (const z of zs) if ((z.id !== 'fullLength' || (o.highlight && o.highlight.includes('fullLength'))) && zoneHit(z, u, sn)) o.tmp.copy(o.base).lerp(new THREE.Color(z.color), o.highlight ? (o.highlight.includes(z.id) ? 0.85 : 0.08) : 0.42); return o.tmp; };
  for (const row of rows) for (const v of row) { const uu = (v.sn * -o.medialX + 1) / 2; push(top, v.x, v.tz, v.z, topColor(v.u, v.sn), uu, v.ui); push(bot, v.x, v.bz, v.z, o.dark, uu, v.ui); }
  for (let i = 0; i < NU - 1; i++) for (let j = 0; j < NV - 1; j++) { const a = i * NV + j, b = a + 1, c = a + NV, d = c + 1; top.idx.push(a, b, c, b, d, c); bot.idx.push(a, c, b, b, c, d); }
  const loop = []; for (let i = 0; i < NU; i++) loop.push(rows[i][NV - 1]); for (let j = NV - 2; j >= 0; j--) loop.push(rows[NU - 1][j]); for (let i = NU - 2; i >= 0; i--) loop.push(rows[i][0]); for (let j = 1; j < NV - 1; j++) loop.push(rows[0][j]);
  const EL = loop.length; for (let k = 0; k < EL; k++) { const v = loop[k]; push(wall, v.x, v.tz, v.z, o.dark, k / EL, 1); push(wall, v.x, v.bz, v.z, o.dark, k / EL, 0); }
  for (let k = 0; k < EL; k++) { const a = 2 * k, b = a + 1, c = (2 * k + 2) % (2 * EL), d = c + 1; wall.idx.push(a, b, c, b, d, c); }
  const toGeo = g => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); geo.setIndex(g.idx); geo.computeVertexNormals(); return geo; };
  const geo = mergeGeometries([toGeo(top), toGeo(bot), toGeo(wall)], true);
  const common = { vertexColors: true, roughness: o.kind === 'insole' ? 0.55 : 0.75, metalness: 0, side: THREE.DoubleSide }, mats = [];
  if (o.uvMode === 'holes') { const t = holesTexture(); mats.push(new THREE.MeshStandardMaterial({ ...common, alphaMap: t, alphaTest: .5 }), new THREE.MeshStandardMaterial({ ...common, alphaMap: t, alphaTest: .5 })); }
  else if (o.uvMode === 'hex') { const t = hexTexture(false).clone(); t.needsUpdate = true; t.repeat.set(2.2, 5.5); mats.push(new THREE.MeshStandardMaterial({ ...common, map: t }), new THREE.MeshStandardMaterial(common)); }
  else mats.push(new THREE.MeshStandardMaterial(common), new THREE.MeshStandardMaterial(common));
  mats.push(new THREE.MeshStandardMaterial(common));
  const m = new THREE.Mesh(geo, mats); m.name = 'sole'; return m;
}

/* ---------------- 4. template morphing (L90 / S90) ---------------- */
const tplCache = new WeakMap();
function templateInfo(src) {
  if (tplCache.has(src)) return tplCache.get(src);
  let g = new THREE.BufferGeometry(); g.setAttribute('position', src.attributes.position.clone()); g = mergeVertices(g, 1e-4); g.computeBoundingBox(); g.computeVertexNormals();
  const bb = g.boundingBox, P = g.attributes.position, N = g.attributes.normal, n = P.count, Lt = bb.max.x - bb.min.x;
  const ew = (a, b) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { const t = (P.getX(i) - bb.min.x) / Lt; if (t >= a && t <= b) { lo = Math.min(lo, P.getY(i)); hi = Math.max(hi, P.getY(i)); } } return hi - lo; };
  const heelAtMin = ew(.02, .1) < ew(.9, .98), uOf = x => { const t = (x - bb.min.x) / Lt; return heelAtMin ? t : 1 - t; };
  const NB = 60, NS = 24, lo = new Float32Array(NB).fill(Infinity), hi = new Float32Array(NB).fill(-Infinity), bin = u => clamp(Math.floor(u * NB), 0, NB - 1);
  for (let i = 0; i < n; i++) { const b = bin(uOf(P.getX(i))); lo[b] = Math.min(lo[b], P.getY(i)); hi[b] = Math.max(hi[b], P.getY(i)); }
  let zP = 0, zM = 0, cP = 0, cM = 0;
  for (let i = 0; i < n; i++) { const u = uOf(P.getX(i)); if (u < .3 || u > .55 || N.getZ(i) < .4) continue; const b = bin(u); if (P.getY(i) > (lo[b] + hi[b]) / 2) { zP += P.getZ(i); cP++; } else { zM += P.getZ(i); cM++; } }
  const medPlusY = zP / (cP || 1) > zM / (cM || 1);
  const snOf = (u, y) => { const b = bin(u), half = Math.max(1, (hi[b] - lo[b]) / 2); let s = (y - (lo[b] + hi[b]) / 2) / half; return medPlusY ? s : -s; };
  const top = Array.from({ length: NB }, () => new Float32Array(NS).fill(-Infinity)), bot = Array.from({ length: NB }, () => new Float32Array(NS).fill(Infinity));
  const sb = sn => clamp(Math.floor((sn + 1) / 2 * NS), 0, NS - 1);
  for (let i = 0; i < n; i++) { const u = uOf(P.getX(i)), sn = snOf(u, P.getY(i)), b = bin(u), s = sb(sn), z = P.getZ(i); if (N.getZ(i) > .35) top[b][s] = Math.max(top[b][s], z); if (N.getZ(i) < -.35) bot[b][s] = Math.min(bot[b][s], z); }
  const fillGrid = (G, bad) => { for (let pass = 0; pass < 30; pass++) for (let b = 0; b < NB; b++) for (let s = 0; s < NS; s++) if (bad(G[b][s])) { const nb = [G[b - 1]?.[s], G[b + 1]?.[s], G[b][s - 1], G[b][s + 1]].filter(v => v !== undefined && !bad(v)); if (nb.length) G[b][s] = nb.reduce((x, y) => x + y) / nb.length; } };
  fillGrid(top, v => !isFinite(v)); fillGrid(bot, v => !isFinite(v));
  const look = (G, u, sn) => G[bin(u)][sb(sn)];
  // template arch apex (highest medial top point) and widest (ball) row
  let tArch = .4, ta = -Infinity, tBall = .7, tw = 0;
  for (let b = 0; b < NB; b++) { const u = (b + .5) / NB; if (u > .2 && u < .65) { const v = look(top, u, .6) - look(bot, u, .6); if (v > ta) { ta = v; tArch = u; } } if (u > .55 && u < .85 && hi[b] - lo[b] > tw) { tw = hi[b] - lo[b]; tBall = u; } }
  const info = { g, uOf, snOf, top, bot, look, tArch, tBall, medPlusY, heelAtMin, Lt };
  tplCache.set(src, info); return info;
}
export function morphTemplate(src, md, { params: p, full = true, color = '#c8784a', zones = [], showZones = false, highlight = null, lastLen = null }) {
  const T = templateInfo(src), F = insoleFrame(md, 'insole', lastLen), coverage = full ? 1 : .72;
  const zEnd = full ? F.zFront : md.zOfU(coverage), Li = F.zBack - zEnd;
  const sU = u => (F.zBack - md.zOfU(u)) / Li;                       // foot-u -> insole-u of this template
  const knots = full ? [[0, 0], [T.tArch, sU(md.archU)], [T.tBall, sU(md.ballU)], [1, 1]] : [[0, 0], [T.tArch, sU(md.archU)], [1, 1]];
  const warpU = ut => { for (let k = 0; k < knots.length - 1; k++) if (ut <= knots[k + 1][0] || k === knots.length - 2) { const [a, b] = knots[k], [c, d] = knots[k + 1]; return b + (ut - a) / (c - a) * (d - b); } };
  const minT = Math.max(1.6, p.minThick || 0), fill = (p.archFill ?? 100) / 100;
  const g = T.g.clone(), P = g.attributes.position, N = g.attributes.normal, n = P.count, arr = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const cB = new THREE.Color(color), tmp = new THREE.Color();
  // top = scanned plantar surface (+ heel cup + mods) + one constant: total contact everywhere, the template's own (curved) bottom is kept,
  // and the constant is the smallest that keeps >= minT thickness over the template bottom (98% of the bed)
  const tgt = new Float32Array(n).fill(NaN), meta = [];
  for (let i = 0; i < n; i++) {
    const ut = T.uOf(P.getX(i)), snT = T.snOf(ut, P.getY(i)), zt = P.getZ(i);
    const ui = warpU(ut), e = F.edge(clamp(ui * Li / F.Li, 0, 1)), z = F.zBack - ui * Li;
    const c = e.c, half = e.half, x = c + md.medialX * snT * half, u = md.uOfZ(z);
    meta.push([ut, snT, zt, x, z, u]);
    if (N.getZ(i) > 0.35) {
      const snc = clamp(snT, -.8, .8), xc = c + md.medialX * snc * half;
      const Pv = Math.min(md.sampleF(xc, z), md.archCap) * (1 - (1 - fill) * gauss(u, .41, .12) * smooth(-0.2, 0.6, snc));
      const rf = md.rowAt(z), fh = Math.max(4, (rf.hi - rf.lo) / 2), sf = (xc - (rf.lo + rf.hi) / 2) * md.medialX / fh;
      const cup = p.heelCupDepth * smooth(.93, 1.05, Math.hypot(Math.max(0, (.12 - u) / .12), sf)) * (1 - smooth(.22, .38, u));
      tgt[i] = Math.max(Pv, cup) + mods(md, p, u, snc, half) - (T.look(T.top, ut, snc) - T.look(T.top, ut, clamp(snT, -1, 1))); // keep the template's own rim shape beyond the bed
    }
  }
  const need = []; for (let i = 0; i < n; i++) if (!isNaN(tgt[i]) && Math.abs(meta[i][1]) < .8) need.push(T.look(T.bot, meta[i][0], meta[i][1]) + minT - tgt[i]);
  const C0 = need.length ? pct(need, .98) : minT;
  for (let i = 0; i < n; i++) {
    const [ut, snT, zt, x, z, u] = meta[i];
    let y = zt;
    if (!isNaN(tgt[i])) y = Math.max(C0 + tgt[i], T.look(T.bot, ut, snT) + minT * .6);
    arr[3 * i] = x; arr[3 * i + 1] = y; arr[3 * i + 2] = z;
    tmp.copy(cB); if (showZones) for (const zn of zones) if ((zn.id !== 'fullLength' || (highlight && highlight.includes('fullLength'))) && zoneHit(zn, u, snT)) tmp.copy(cB).lerp(new THREE.Color(zn.color), highlight ? (highlight.includes(zn.id) ? .85 : .1) : .5);
    col.set([tmp.r, tmp.g, tmp.b], 3 * i);
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(arr, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setIndex(g.index.clone());
  // lift so the lowest point sits on y = 0
  out.computeBoundingBox(); out.translate(0, -out.boundingBox.min.y, 0); out.computeVertexNormals();
  out.userData = { warp: { knots, coverage, templateArchU: T.tArch, templateBallU: T.tBall } };
  return out;
}

/* ---------------- printable conversion (Z-up, Z=0, outward normals) ---------------- */
export function toPrintable(geoIn, points = []) {
  let g = new THREE.BufferGeometry(); g.setAttribute('position', geoIn.attributes.position.clone()); g.setIndex(geoIn.index.clone());
  g = mergeVertices(g, 1e-4); g.rotateX(Math.PI / 2); g.computeBoundingBox();
  const bb0 = g.boundingBox, off = new THREE.Vector3(-(bb0.min.x + bb0.max.x) / 2, -(bb0.min.y + bb0.max.y) / 2, -bb0.min.z); g.translate(off.x, off.y, off.z);
  const P = g.attributes.position, I = g.index.array; let vol = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < I.length; i += 3) { a.fromBufferAttribute(P, I[i]); b.fromBufferAttribute(P, I[i + 1]); c.fromBufferAttribute(P, I[i + 2]); vol += a.dot(b.cross(c)) / 6; }
  if (vol < 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.index.needsUpdate = true; vol = -vol; }
  g.computeVertexNormals(); g.computeBoundingBox(); const bb = g.boundingBox;
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2), mapPt = v => v.clone().applyMatrix4(rot).add(off);
  return { geometry: g, stats: { volumeMm3: Math.round(vol), triangles: I.length / 3, sizeMm: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map(v => +v.toFixed(1)) }, points: points.map(mapPt) };
}

/* ---------------- 5. fit check ---------------- */
export function fitCheck(md, geo, p) {
  const G = md.grid, { res, x0, z0, nx, nz, raw } = G, T = new Float32Array(nx * nz).fill(-Infinity);
  const P = geo.attributes.position, I = geo.index ? geo.index.array : null, nt = I ? I.length / 3 : P.count / 3;
  // top surface of the product = upward-facing triangles (max height per cell)
  rasterTris(P, I, nt, G, T, 'max', t => { const A = t.A, B = t.B, C = t.C; const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]; const nX = uy * vz - uz * vy, nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx; return Math.abs(nY) / Math.hypot(nX, nY, nZ) > .3; });
  const tests = modZoneTest(md, p), cells = [];
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i, h = raw[k]; if (isNaN(h) || h > 25 || !isFinite(T[k])) continue;
    let interior = true; for (let d = 1; d <= 2 && interior; d++) for (const [di, dj] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || isNaN(raw[jj * nx + ii]) || !isFinite(T[jj * nx + ii])) interior = false; }
    if (!interior) continue;
    const x = x0 + (i + .5) * res, z = z0 + (j + .5) * res, u = md.uOfZ(z), r = md.rowAt(z), c = (r.lo + r.hi) / 2, sn = clamp(md.medialX * (x - c) / ((r.hi - r.lo) / 2 || 1), -1, 1);
    const mod = tests.find(([, f]) => f(u, sn));
    cells.push({ k, x, z, h, t: T[k], u, sn, mod: mod ? mod[0] : null });
  }
  // the foot stands on the insole: best rigid placement = offset + tilt (least squares, robust) on the non-modified area
  let a = 0, b = 0, c = 0;
  for (let pass = 0; pass < 3; pass++) {
    const use = cells.filter(q => !q.mod && (pass === 0 || Math.abs(q.h + a + b * q.x + c * q.z - q.t) < 3)); if (use.length < 10) break;
    let s = [0, 0, 0, 0, 0, 0, 0, 0, 0], r = [0, 0, 0];
    for (const q of use) { const v = [1, q.x, q.z], y = q.t - q.h; for (let m = 0; m < 3; m++) { r[m] += v[m] * y; for (let nn = 0; nn < 3; nn++) s[m * 3 + nn] += v[m] * v[nn]; } }
    const M = new THREE.Matrix3().fromArray(s).transpose(), inv = M.clone().invert(), sol = new THREE.Vector3(...r).applyMatrix3(inv); a = sol.x; b = sol.y; c = sol.z;
  }
  const gap = new Float32Array(nx * nz).fill(NaN), modMask = new Uint8Array(nx * nz);
  const stat = list => { if (!list.length) return null; const g = list.map(q => q.g), ab = g.map(Math.abs); return { cells: list.length, areaCm2: +(list.length * res * res / 100).toFixed(1), meanAbs: +(ab.reduce((x, y) => x + y, 0) / ab.length).toFixed(2), mean: +(g.reduce((x, y) => x + y, 0) / g.length).toFixed(2), maxGap: +Math.max(0, ...g).toFixed(1), maxPress: +Math.max(0, ...g.map(v => -v)).toFixed(1), within1: Math.round(ab.filter(v => v <= 1).length / ab.length * 100), within2: Math.round(ab.filter(v => v <= 2).length / ab.length * 100), p95: +pct(ab, .95).toFixed(1) }; };
  for (const q of cells) { q.g = (q.h + a + b * q.x + c * q.z) - q.t; gap[q.k] = q.g; if (q.mod) modMask[q.k] = 1; }
  const core = cells.filter(q => !q.mod), st = stat(core), all = stat(cells);
  const byMod = {}; cells.filter(q => q.mod).forEach(q => (byMod[q.mod] ||= []).push(q));
  const modStats = Object.entries(byMod).map(([name, l]) => ({ name, ...stat(l) }));
  const pass = !!st && st.meanAbs < 1 && st.within1 >= 80;
  const tilt = { xDeg: +THREE.MathUtils.radToDeg(Math.atan(b)).toFixed(1), zDeg: +THREE.MathUtils.radToDeg(Math.atan(c)).toFixed(1), offsetMm: +a.toFixed(1) };
  return { gap, modMask, stats: st, statsAll: all, modStats, tilt, pass, verdict: pass ? 'PASS' : st && st.meanAbs < 1.6 ? 'WARN' : 'FAIL', grid: G };
}
export const GAP_COLORS = g => { const c = new THREE.Color(); if (isNaN(g)) return c.set('#c9d3dd'); const a = Math.abs(g); if (a <= 1) return c.set('#27ae60').lerp(new THREE.Color('#a8e6b8'), a); return g > 0 ? c.set('#5cc2ff').lerp(new THREE.Color('#0b47a8'), clamp((a - 1) / 3, 0, 1)) : c.set('#f2c94c').lerp(new THREE.Color('#d63031'), clamp((a - 1) / 3, 0, 1)); };
export function colorByGap(geo, fit) {
  const G = fit.grid, P = geo.attributes.position, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { const ii = Math.floor((P.getX(i) - G.x0) / G.res), jj = Math.floor((P.getZ(i) - G.z0) / G.res); const g = ii >= 0 && jj >= 0 && ii < G.nx && jj < G.nz ? fit.gap[jj * G.nx + ii] : NaN; const c = GAP_COLORS(g); col.set([c.r, c.g, c.b], 3 * i); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
}
export function drawFitMap(canvas, md, fit) {
  const ctx = canvas.getContext('2d'), G = fit.grid, W = canvas.width, H = canvas.height; ctx.clearRect(0, 0, W, H);
  const s = Math.min((W - 20) / (G.nx * G.res), (H - 20) / (G.nz * G.res)), ox = (W - G.nx * G.res * s) / 2, oy = (H - G.nz * G.res * s) / 2;
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) { const k = j * G.nx + i; const inFoot = !isNaN(G.raw[k]); if (!inFoot) continue; const g = fit.gap[k]; ctx.fillStyle = '#' + GAP_COLORS(g).getHexString(); ctx.fillRect(ox + i * G.res * s, oy + j * G.res * s, G.res * s + .5, G.res * s + .5); if (fit.modMask[k]) { ctx.fillStyle = 'rgba(255,255,255,.28)'; if ((i + j) % 3 === 0) ctx.fillRect(ox + i * G.res * s, oy + j * G.res * s, G.res * s + .5, G.res * s + .5); } }
  // toe gap + ball line landmarks
  const X = x => ox + (x - G.x0) * s, Z = z => oy + (z - G.z0) * s;
  ctx.strokeStyle = '#162327'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; const zb = md.zOfU(md.ballU), rb = md.rowAt(zb); ctx.beginPath(); ctx.moveTo(X(rb.lo) - 6, Z(zb)); ctx.lineTo(X(rb.hi) + 6, Z(zb)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#162327'; ctx.beginPath(); ctx.arc(X(md.toeGap.x), Z(md.toeGap.z), 3.5, 0, 7); ctx.fill();
  ctx.font = '11px sans-serif'; ctx.fillText('ball line', X(rb.hi) + 8, Z(zb) + 4); ctx.fillText('toe gap', X(md.toeGap.x) + 6, Z(md.toeGap.z) - 4);
}
