// Fixifoot v9 – personalised initials / name as REAL geometry (engraved into the heel of the STL / 3MF bodies).
// Booleans with manifold-3d (WASM, Apache-2.0, vendor/manifold), glyphs from Helvetiker Bold (vendor/fonts).
// Frame: three.js Y-up, product length along Z, width along X (same frame as the sole / 2-material bodies before export).
import * as THREE from 'three';
import { Font } from 'three/addons/FontLoader.js';
import FONT from './vendor/fonts/fx-font.js';

export const TEXT_RULES = { maxChars: 6, depthMm: 0.6, minFeatureMm: 1.2, capMm: 8, minCapMm: 6.5 };
export const cleanText = s => String(s || '').toUpperCase().replace(/[^A-Z0-9&.\-' ]/g, '').replace(/\s+/g, ' ').replace(/^ /, '').slice(0, TEXT_RULES.maxChars);
const font = new Font(FONT);
let MF = null, loading = null, SIMPLIFY = 0;
export const setSimplify = v => (SIMPLIFY = v);
export const engraverReady = () => !!MF;
export function loadEngraver() {
  if (MF) return Promise.resolve(MF);
  return (loading ||= (async () => {
    const mod = await import('./vendor/manifold/manifold.js');
    const opts = {};
    if (window.__FX_MANIFOLD_WASM) { const s = atob(window.__FX_MANIFOLD_WASM), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); opts.wasmBinary = u; }
    if (opts.wasmBinary) opts.locateFile = () => 'manifold.wasm'; // standalone: embedded WASM, no fetch
    const w = await mod.default(opts); w.setup(); MF = w; return w;
  })().catch(e => { loading = null; throw e; }));
}

// glyph outlines -> polygons (mm), cap height = cap, centred on (0,0); then morphological closing + opening so every stroke
// AND every gap is >= minFeature (1.2 mm) – nothing thinner than one 0.4 mm nozzle x 3 lines survives.
const CAP_RATIO = (() => { const s = font.generateShapes('H', 1); const b = new THREE.Box2(); s.forEach(sh => sh.getPoints(4).forEach(p => b.expandByPoint(p))); return b.max.y - b.min.y; })();
export function textPolys(text, cap) {
  // per letter (own advance + 12 % cap tracking) so neighbouring letters never touch after the 1.2 mm closing
  const size = cap / CAP_RATIO, scale = size / FONT.resolution, track = .12 * cap, letters = []; let x = 0;
  for (const ch of text) {
    const g = FONT.glyphs[ch] || FONT.glyphs['?']; if (!g) continue;
    if (ch !== ' ') { const polys = []; for (const sh of font.generateShapes(ch, size)) { const e = sh.extractPoints(6); for (const ring of [e.shape, ...e.holes]) if (ring.length > 2) polys.push(ring.map(p => [p.x + x, p.y])); } if (polys.length) letters.push(polys); }
    x += g.ha * scale + track;
  }
  const bb = new THREE.Box2(); letters.flat().flat().forEach(([px, py]) => bb.expandByPoint(new THREE.Vector2(px, py)));
  const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  const L = letters.map(polys => polys.map(r => r.map(([px, py]) => [px - cx, py - cy])));
  return { letters: L, polys: L.flat(), w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y };
}
export function measureText(text, cap = TEXT_RULES.capMm) { const t = textPolys(text, cap); return { w: t.w, h: t.h }; }

// --- three <-> manifold ---
export function closedF32(g) { // watertight as an STL reader sees it (positions merged exactly as float32)
  const P = g.attributes.position.array, I = g.index ? g.index.array : Uint32Array.from({ length: P.length / 3 }, (_, i) => i), key = new Map(), id = new Uint32Array(P.length / 3);
  for (let i = 0; i < id.length; i++) { const k = P[3 * i] + ',' + P[3 * i + 1] + ',' + P[3 * i + 2]; let v = key.get(k); if (v === undefined) { v = key.size; key.set(k, v); } id[i] = v; }
  const E = new Map();
  for (let t = 0; t < I.length; t += 3) { const a = id[I[t]], b = id[I[t + 1]], c = id[I[t + 2]]; if (a === b || b === c || a === c) return false; for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? p * 4294967296 + q : q * 4294967296 + p; E.set(k, (E.get(k) || 0) + 1); } }
  for (const n of E.values()) if (n !== 2) return false; return true;
}
// final-frame safety net: after a rotation / translation float32 rounding can fuse two nearly-coincident vertices
// (non-manifold edge in the STL). If so, re-merge + simplify by a few microns until the STL is closed again.
export function ensureClosed(geo) {
  if (!MF || closedF32(geo)) return { geo, fixed: 0 };
  let m = toManifold(geo), k = 0;
  for (const tol of [5e-4, 2e-3, 5e-3, 1e-2]) { const q = m.simplify(tol); m.delete(); m = q; k++; const g = toGeo(m); if (closedF32(g)) { m.delete(); return { geo: g, fixed: k }; } }
  m.delete(); return { geo, fixed: -1 };
}
function toManifold(geo) {
  const { Manifold, Mesh } = MF; const g = geo.index ? geo : (() => { const n = geo.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; const h = geo.clone(); h.setIndex(new THREE.BufferAttribute(idx, 1)); return h; })();
  const vp = Float32Array.from(g.attributes.position.array), tv = Uint32Array.from(g.index.array);
  let vol = 0; for (let i = 0; i < tv.length; i += 3) { const a = 3 * tv[i], b = 3 * tv[i + 1], c = 3 * tv[i + 2]; vol += vp[a] * (vp[b + 1] * vp[c + 2] - vp[b + 2] * vp[c + 1]) - vp[a + 1] * (vp[b] * vp[c + 2] - vp[b + 2] * vp[c]) + vp[a + 2] * (vp[b] * vp[c + 1] - vp[b + 1] * vp[c]); }
  if (vol < 0) for (let i = 0; i < tv.length; i += 3) { const t = tv[i + 1]; tv[i + 1] = tv[i + 2]; tv[i + 2] = t; } // inside-out input (some sole builders) -> outward
  const mesh = new Mesh({ numProp: 3, vertProperties: vp, triVerts: tv });
  mesh.merge(); return new Manifold(mesh);
}
function toGeo(m) {
  const mesh = m.getMesh(), np = mesh.numProp, vp = mesh.vertProperties, n = vp.length / np, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2]; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triVerts), 1)); g.computeVertexNormals(); return g;
}

// heel frame from the geometry itself: long axis = Z, heel = the narrower end (works for all insoles, 3/4 Dress and sandal soles)
export function heelFrame(geos) {
  const box = new THREE.Box3(); geos.forEach(g => { g.computeBoundingBox(); box.union(g.boundingBox); });
  const L = box.max.z - box.min.z, slice = (z0, z1) => { let lo = Infinity, hi = -Infinity; for (const g of geos) { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const z = P.getZ(i); if (z >= z0 && z <= z1) { const x = P.getX(i); if (x < lo) lo = x; if (x > hi) hi = x; } } } return { lo, hi, w: hi - lo, c: (lo + hi) / 2 }; };
  const a = slice(box.min.z + .12 * L, box.min.z + .2 * L), b = slice(box.max.z - .2 * L, box.max.z - .12 * L);
  const heelAtMax = b.w < a.w, dir = heelAtMax ? -1 : 1; // dir = heel -> toe along z
  const zAt = f => heelAtMax ? box.max.z - f * L : box.min.z + f * L;
  return { L, dir, zAt, slice: f => slice(zAt(f) - 4, zAt(f) + 4), box };
}

// height field (max top / min bottom) over a rectangle, from the triangles facing up / down
function heightField(geos, rect, where, res = .5) {
  const nx = Math.ceil((rect.x1 - rect.x0) / res) + 1, nz = Math.ceil((rect.z1 - rect.z0) / res) + 1, H = new Float32Array(nx * nz).fill(NaN);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const g of geos) {
    const P = g.attributes.position, I = g.index ? g.index.array : null, nt = I ? I.length / 3 : P.count / 3;
    for (let t = 0; t < nt; t++) {
      a.fromBufferAttribute(P, I ? I[3 * t] : 3 * t); b.fromBufferAttribute(P, I ? I[3 * t + 1] : 3 * t + 1); c.fromBufferAttribute(P, I ? I[3 * t + 2] : 3 * t + 2);
      const xmin = Math.min(a.x, b.x, c.x), xmax = Math.max(a.x, b.x, c.x), zmin = Math.min(a.z, b.z, c.z), zmax = Math.max(a.z, b.z, c.z);
      if (xmax < rect.x0 || xmin > rect.x1 || zmax < rect.z0 || zmin > rect.z1) continue;
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const len = n.length(); if (!len) continue; const ny = n.y / len;
      if (Math.abs(ny) < .25) continue; // skip walls; winding-independent (max = top, min = bottom)
      const i0 = Math.max(0, Math.ceil((xmin - rect.x0) / res)), i1 = Math.min(nx - 1, Math.floor((xmax - rect.x0) / res)), j0 = Math.max(0, Math.ceil((zmin - rect.z0) / res)), j1 = Math.min(nz - 1, Math.floor((zmax - rect.z0) / res));
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-12) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = rect.x0 + i * res, z = rect.z0 + j * res, w1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d, w2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d, w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
        const y = w1 * a.y + w2 * b.y + w3 * c.y, k = j * nx + i, cur = H[k];
        if (isNaN(cur) || (where === 'top' ? y > cur : y < cur)) H[k] = y;
      }
    }
  }
  // fill holes (openings) by neighbour averaging so the pocket floor stays smooth
  for (let pass = 0; pass < 40; pass++) { let miss = 0; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!isNaN(H[k])) continue; let s = 0, m = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && !isNaN(H[jj * nx + ii])) { s += H[jj * nx + ii]; m++; } } if (m) H[k] = s / m; else miss++; } if (!miss) break; }
  return (x, z) => { const fx = Math.min(nx - 1.001, Math.max(0, (x - rect.x0) / res)), fz = Math.min(nz - 1.001, Math.max(0, (z - rect.z0) / res)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = (ii, jj) => { const h = H[jj * nx + ii]; return isNaN(h) ? 0 : h; };
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v; };
}

/* plan the text placement on the heel: across the heel (reads left -> right with the toes pointing up when you look at the
   engraved face) or, when too long, along the heel/arch centre line. Returns null when it cannot fit at >= minCap. */
export function planText(geos, text, where = 'top', uAt = .17) {
  const t = cleanText(text).trim(); if (!t) return null;
  const F = heelFrame(geos), at = F.slice(uAt), wAcross = at.w * (uAt > .25 ? .46 : .5);
  let cap = TEXT_RULES.capMm, m = measureText(t, cap), orient = 'across';
  if (m.w > wAcross) { cap = Math.max(TEXT_RULES.minCapMm, cap * wAcross / m.w); m = measureText(t, cap); }
  if (m.w > wAcross + .01) { // along the centre line (heel -> arch), letters' tops pointing to the lateral... keep simple: tops to the left when toes point up
    orient = 'along'; cap = Math.min(TEXT_RULES.capMm, F.slice(.2).w * .42); m = measureText(t, cap);
    const lMax = F.L * .3; if (m.w > lMax) { cap = cap * lMax / m.w; m = measureText(t, cap); }
    if (cap < TEXT_RULES.minCapMm - 1e-6) return null;
  }
  const fu = orient === 'across' ? uAt : (uAt > .25 ? uAt : .06 + (m.w / F.L) / 2 + .02), c = F.slice(Math.min(fu, .45));
  return { text: t, cap: +cap.toFixed(2), orient, where, center: { x: c.c, z: F.zAt(fu) }, dir: F.dir, sizeMm: [+m.w.toFixed(1), +m.h.toFixed(1)], L: F.L };
}

// glyph (gx, gy) -> world (x, z). Seen from the engraved face with the toes pointing up, text reads left -> right.
function axes(plan) {
  const d = plan.dir, mir = plan.where === 'bottom' ? -1 : 1; // looking from below mirrors X
  // toe direction on screen = up; right on screen (from above) = -d * X
  const up = { x: 0, z: d }, right = { x: -d * mir, z: 0 };
  return plan.orient === 'across' ? { ax: right.x, az: right.z, bx: up.x, bz: up.z } : { ax: up.x, az: up.z, bx: -right.x, bz: -right.z };
}

// cutter solids: shallow = pocket depth 0.6 mm under the surface; deep = through everything below (for the 2-colour inlay)
function cutters(geos, plan, wantDeep) {
  const { CrossSection, Manifold } = MF, tp = textPolys(plan.text, plan.cap);
  let A = axes(plan); const r = TEXT_RULES.minFeatureMm / 2;
  // per letter: closing (gaps < 1.2 mm filled) then opening (strokes < 1.2 mm removed); letters are >= 1.2 mm apart by tracking
  const parts = tp.letters.map(pl => new CrossSection(pl, 'EvenOdd').offset(r, 'Round', 2, 24).offset(-r, 'Round', 2, 24).offset(-r, 'Round', 2, 24).offset(r, 'Round', 2, 24));
  let cs = CrossSection.union(parts);
  if (A.ax * A.bz - A.bx * A.az > 0) { cs = cs.mirror([1, 0]); A = { ax: -A.ax, az: -A.az, bx: A.bx, bz: A.bz }; } // keep the warp orientation-preserving
  const pad = 3, half = Math.max(tp.w, tp.h) / 2 + pad, cx = plan.center.x, cz = plan.center.z;
  const rect = { x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half };
  const H = heightField(geos, rect, plan.where), Hb = wantDeep ? heightField(geos, rect, plan.where === 'top' ? 'bottom' : 'top') : null;
  const D = TEXT_RULES.depthMm, area = cs.area();
  const csIn = wantDeep ? cs.offset(-.02, 'Round', 2, 24) : null; // band 20 µm inside the cut: never overlaps the top layer (no coplanar walls)
  const make = (lo, hi, sec = cs) => { // lo/hi(h = engraved surface, b = opposite surface) -> y at the bottom / top of the prism
    let m = sec.extrude(1); m = m.refineToLength(1.0);
    return m.warp(v => { const gx = v[0], gy = v[1], t = v[2], x = cx + A.ax * gx + A.bx * gy, z = cz + A.az * gx + A.bz * gy, h = H(x, z), b = Hb ? Hb(x, z) : 0; v[0] = x; v[2] = z; const y0 = lo(h, b), y1 = hi(h, b); v[1] = y0 + (y1 - y0) * t; });
  };
  const top = plan.where === 'top';
  const shallow = top ? make(h => h - D, h => h + 2) : make(h => h - 2, h => h + D);
  const deep = wantDeep ? make(h => h - 40, h => h + 2) : null;
  // band: base-colour fill from inside the base (overlapping volume, never coplanar) up to 0.6 mm below the surface
  const band = wantDeep ? make((h, b) => Math.max(h - D - 2.6, b + .45), h => h - D, csIn) : null;
  return { shallow, deep, band, areaMm2: +area.toFixed(1) };
}

/* engrave the bodies in place. mode 'layer' (base + top layer): the top layer gets a through-cut in the text shape and the base
   fills it up to 0.6 mm below the surface -> sunk 0.6 mm text in the BASE colour, every layer stays >= 1.2 mm (no thin skin).
   mode 'cut': 0.6 mm pocket subtracted from every body (shells / inserts / single STL). Returns { geos, info } or throws. */
export function engraveBodies(geos, plan, mode = 'cut') {
  if (!MF) throw new Error('engraver not loaded');
  const ms = geos.map(toManifold);
  for (const m of ms) if (m.isEmpty()) throw new Error('body is not a closed solid');
  const c = cutters(geos, plan, mode === 'layer');
  let out;
  if (mode === 'layer' && ms.length === 2) {
    const [base, top] = ms;
    out = [base.add(c.band), top.subtract(c.deep)];
  } else out = ms.map(m => m.subtract(c.shallow));
  if (SIMPLIFY) out = out.map(m => { const q = m.simplify(SIMPLIFY); m.delete(); return q; });
  const removed = ms.reduce((s, m, i) => s + m.volume(), 0) - out.reduce((s, m) => s + m.volume(), 0);
  // float32 export check: every edge shared by exactly 2 triangles after merging equal positions; else collapse slivers on THAT body only
  let cleaned = 0;
  const res = out.map((m, i) => { let g = toGeo(m); for (const tol of [5e-4, 2e-3, 5e-3]) { if (closedF32(g)) break; const q = m.simplify(tol); g = toGeo(q); out[i] = q; m.delete(); m = q; cleaned++; } return g; });
  const info = { text: plan.text, location: plan.where === 'top' ? 'heel – top surface' : 'heel – underside (no edges against the skin)', orientation: plan.orient, capHeightMm: plan.cap, sizeMm: plan.sizeMm,
    depthMm: TEXT_RULES.depthMm, minFeatureMm: TEXT_RULES.minFeatureMm, method: mode === 'layer' ? 'two-colour inlay: top layer cut through in the letter shapes, base colour fills them up to 0.6 mm below the surface' : '0.6 mm deep pocket',
    textAreaMm2: c.areaMm2, removedVolumeMm3: +removed.toFixed(1), realGeometry: true, watertightCheck: res.every(closedF32), sliverCleanups: cleaned, at: { x: +plan.center.x.toFixed(1), z: +plan.center.z.toFixed(1), dir: plan.dir, where: plan.where } };
  [...ms, ...out, c.shallow, c.deep, c.band].forEach(m => m?.delete?.());
  return { geos: res, info };
}
