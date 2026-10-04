// Fixifoot demo – procedural geometry (foot, insoles, footwear) + uploaded mesh processing
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/BufferGeometryUtils.js';

import { buildOpenSole, rowSampler, defaultAllow } from './openings.js';
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const ellIn = (u, sn, cu, cs, ru, rs) => 1 - smooth(0.7, 1, Math.hypot((u - cu) / ru, (sn - cs) / rs));

// ---------- foot outline (s = medial-positive mm) ----------
const MED = [[0, 0], [.015, .13], [.05, .22], [.12, .30], [.25, .29], [.40, .27], [.55, .34], [.68, .44], [.74, .46], [.82, .43], [.90, .36], [.96, .24], [1, .07]];
const LAT = [[0, 0], [.015, -.13], [.05, -.22], [.12, -.31], [.25, -.33], [.40, -.36], [.55, -.42], [.68, -.50], [.74, -.49], [.82, -.42], [.90, -.30], [.96, -.12], [1, .05]];
function interp(tab, u) {
  u = Math.min(1, Math.max(0, u));
  let i = 0; while (i < tab.length - 2 && u > tab[i + 1][0]) i++;
  const p0 = tab[Math.max(0, i - 1)], p1 = tab[i], p2 = tab[i + 1], p3 = tab[Math.min(tab.length - 1, i + 2)];
  const t = (u - p1[0]) / (p2[0] - p1[0]);
  const m1 = (p2[1] - p0[1]) / 2, m2 = (p3[1] - p1[1]) / 2, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}
export function outline(u, W, opt = {}) {
  const k = W / 0.95;
  let m = interp(MED, u) * k, l = interp(LAT, u) * k;
  if (opt.extraFore) { const f = smooth(.55, .7, u) * (1 - smooth(.92, 1, u)) * opt.extraFore / 2; m += f; l -= f; }
  if (opt.lateralFlare) l -= 3 * (1 - smooth(.25, .42, u)) * smooth(0, .06, u);
  return { m, l };
}

// ---------- pressure model (shared by 3D foot + 2D footprint) ----------
const ARCH_CONTACT = { high: -0.62, normal: -0.1, low: 0.45, flat: 1.1 }; // medial limit of midfoot contact
export function contactAt(u, sn, archType) {
  const lim = ARCH_CONTACT[archType] ?? -0.1;
  const mid = smooth(.22, .36, u) * (1 - smooth(.56, .68, u));
  const limit = 1 * (1 - mid) + lim * mid;
  return sn <= limit;
}
export function pressureAt(u, sn, archType, peak = 0.8) {
  let p = 0.95 * gauss(u, .12, .08) * (1 - 0.3 * Math.abs(sn));
  p += peak * gauss(u, .71, .055) * (0.75 + 0.25 * gauss(sn, .25, .5));
  p += 0.55 * gauss(u, .92, .04) * gauss(sn, .55, .35);
  const midW = { high: .12, normal: .28, low: .42, flat: .55 }[archType] ?? .28;
  p += midW * gauss(u, .45, .15) * (archType === 'flat' ? 1 : smooth(0.4, -0.6, sn));
  return Math.min(1, p);
}
const RAMP = [[0, '#2f6bed'], [.3, '#27c2a8'], [.55, '#f2d24a'], [.75, '#f2994a'], [1, '#eb5757']].map(([t, c]) => [t, new THREE.Color(c)]);
export function heatColor(t, out = new THREE.Color()) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 0; i < RAMP.length - 1; i++) if (t <= RAMP[i + 1][0]) {
    const k = (t - RAMP[i][0]) / (RAMP[i + 1][0] - RAMP[i][0]); return out.copy(RAMP[i][1]).lerp(RAMP[i + 1][1], k);
  }
  return out.copy(RAMP[RAMP.length - 1][1]);
}

// ---------- procedural foot ----------
const HTOP = [[0, 34], [.06, 58], [.18, 82], [.3, 86], [.45, 68], [.6, 48], [.74, 32], [.84, 24], [1, 20]];
const ARCH_LIFT = { high: 17, normal: 10, low: 5, flat: 1.2 };
function buildFootProcedural({ L = 260, W = 100, archType = 'normal', side = 'R', peak = 0.8 }) {
  const mir = side === 'R' ? -1 : 1;
  const NU = 72, M = 48, u0 = 0.004, u1 = 0.84;
  const pos = [], idx = [], meta = [];
  const toXYZ = (u, s, z) => [mir * s, z, (0.5 - u) * L];
  for (let i = 0; i < NU; i++) {
    const t = i / (NU - 1), u = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos(Math.PI * t)) ;
    const { m, l } = outline(u, W);
    const hw = (m - l) / 2, c = (m + l) / 2, H = interp(HTOP, u) * (L / 260);
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
      const sp = (v, e) => Math.sign(v) * Math.abs(v) ** e;
      let x = c + hw * sp(cx, 0.55) * (sy > 0 ? 1 - 0.22 * sy : 1);
      let z;
      if (sy >= 0) z = 3 + (H - 3) * Math.pow(sy, 0.85) * (1 + 0.12 * cx);
      else {
        z = 3 * (1 - Math.pow(-sy, 0.35));
        const sn = (x - c) / hw;
        z += ARCH_LIFT[archType] * gauss(u, .45, .13) * smooth(-0.25, 0.9, sn) * Math.pow(-sy, 0.3);
      }
      pos.push(...toXYZ(u, x, z));
    }
  }
  for (let i = 0; i < NU - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c2 = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
    idx.push(a, c2, b, b, c2, d);
  }
  // caps
  for (const [ring, flip] of [[0, true], [NU - 1, false]]) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < M; j++) { cx += pos[(ring * M + j) * 3]; cy += pos[(ring * M + j) * 3 + 1]; cz += pos[(ring * M + j) * 3 + 2]; }
    const ci = pos.length / 3; pos.push(cx / M, cy / M, cz / M);
    for (let j = 0; j < M; j++) { const a = ring * M + j, b = ring * M + (j + 1) % M; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const geoms = [g];
  // toes
  const toes = [[.925, .27, 13, 16, 12], [.915, .05, 8.5, 11, 9], [.895, -.12, 8, 10, 8.5], [.87, -.27, 7.5, 9.5, 8], [.835, -.40, 7, 8.5, 7.5]];
  for (const [u, sW, rx, rz, ry] of toes) {
    const sg = new THREE.SphereGeometry(1, 20, 14); sg.scale(rx * W / 100, ry, rz * L / 260);
    const [x, , z] = toXYZ(u, sW * W, 0); sg.translate(x, ry * 0.95, z); geoms.push(sg);
  }
  const all = mergeGeometries(geoms.map(x => { x = x.index ? x : x; const n = x.toNonIndexed(); n.deleteAttribute('uv'); return n; }));
  all.computeVertexNormals();
  // heatmap colours
  const P = all.attributes.position, col = new Float32Array(P.count * 3), cc = new THREE.Color(), skin = new THREE.Color('#d8e6e3');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), u = 0.5 - z / L, s = x * mir;
    const { m, l } = outline(Math.min(u, .99), W); const sn = Math.max(-1, Math.min(1, 2 * (s - l) / (m - l || 1) - 1));
    const contact = Math.exp(-Math.max(0, y - 0.6) / 2.2);
    let pr = contactAt(u, sn, archType) || u > .8 ? pressureAt(u, sn, archType, peak) : 0.04;
    heatColor(pr, cc); cc.lerp(skin, 1 - contact * 0.95);
    col.set([cc.r, cc.g, cc.b], i * 3);
  }
  all.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(all, mat); mesh.name = 'foot';
  return mesh;
}

// ---------- 2D footprint (analysis screen) ----------
export function drawFootprint(canvas, { archType, peak = 0.8, side = 'R', W = 100 }) {
  const ctx = canvas.getContext('2d'), CW = canvas.width, CH = canvas.height;
  ctx.clearRect(0, 0, CW, CH);
  const img = ctx.createImageData(CW, CH), cc = new THREE.Color();
  const pad = 14, Lp = CH - pad * 2, scale = Lp / 260, Wmm = W;
  for (let py = 0; py < CH; py++) for (let px = 0; px < CW; px++) {
    const u = 1 - (py - pad) / Lp; if (u < 0 || u > 1) continue;
    const s = (side === 'R' ? -1 : 1) * (px - CW / 2) / scale;
    const { m, l } = outline(u, Wmm);
    if (s > m || s < l) continue;
    const sn = 2 * (s - l) / (m - l) - 1;
    const k = (py * CW + px) * 4;
    if (u > 0.83) { // toe area: split into toes
      const toeGap = Math.sin((sn + 1) * Math.PI * 2.6) > 0.82 && u < 0.97;
      if (toeGap) continue;
    }
    if (contactAt(u, sn, archType) || u > 0.8) heatColor(pressureAt(u, sn, archType, peak), cc); else cc.set('#e6eeed');
    img.data[k] = cc.r * 255; img.data[k + 1] = cc.g * 255; img.data[k + 2] = cc.b * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#5d7471'; ctx.font = '12px sans-serif'; ctx.fillText(side === 'R' ? 'Right' : 'Left', 6, 16);
}

// ---------- textures ----------
const texCache = {};
export function holesTexture() {
  if (texCache.holes) return texCache.holes;
  const c = document.createElement('canvas'); c.width = 256; c.height = 640; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 640); x.fillStyle = '#000';
  for (let r = 0, y = 26; y < 616; r++, y += 15) for (let cx = (r % 2 ? 24 : 32); cx < 236; cx += 16) {
    if (Math.abs(cx - 128) > 104) continue; x.beginPath(); x.arc(cx, y, 4.6, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return (texCache.holes = t);
}
export function hexTexture(holes) {
  const key = holes ? 'hexA' : 'hexM'; if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = holes ? '#000' : '#ffffff'; x.fillRect(0, 0, 512, 512);
  const R = 18, h = Math.sqrt(3) * R;
  x.strokeStyle = holes ? '#fff' : '#8a8a8a'; x.lineWidth = holes ? 13 : 3.2;
  for (let col = -1; col < 512 / (1.5 * R) + 1; col++) for (let row = -1; row < 512 / h + 1; row++) {
    const cx = col * 1.5 * R, cy = row * h + (col % 2 ? h / 2 : 0);
    x.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k; x.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); } x.closePath(); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (holes) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; } return (texCache[key] = t);
}

// ---------- sole / insole surface ----------
function topHeight(u, sn, p, kind, hw, integrate) {
  let base = kind === 'insole' ? (p._thick || 2.6) : kind === 'flipflop' ? 11 : 13;
  const M = kind === 'insole' ? p._model : null; // v7 insole line
  // shell thickness by zone (clinical): thicker under heel/midfoot, thin (sulcus) forefoot so the toes have room
  if (M) base = Math.max(1.6, (p._scale || 1) * (M.heelT + (M.foreT - M.heelT) * smooth(.15, .75, u)));
  else if (kind === 'insole') base = Math.max(1.6, base * (0.7 + 0.45 * (1 - smooth(.58, .78, u))));
  if (p.minThick) base = Math.max(base, p.minThick); // diabetic accommodative: >= 6 mm cushioning everywhere
  if (kind !== 'insole') base += 5 * (1 - smooth(.3, .72, u));
  let z = base;
  const k = kind === 'insole' || integrate ? 1 : 0.3;
  if (p._plantar) {
    // TOTAL CONTACT: top surface follows the customer's scanned plantar surface (minus ~15% soft-tissue
    // compression allowance), only in the rearfoot/midfoot; the forefoot stays flat for toe-off.
    const pl = p._plantar(u, sn) * 0.85 * (1 - smooth(.62, .74, u));
    z += k * Math.min(pl, p.archHeight + 4);
  } else {
    // arch apex at ~41% of length from the heel (navicular), medial-biased
    z += k * p.archHeight * gauss(u, .41, .12) * smooth(-0.3, 0.95, sn);
    if (p.fullContact) z += k * p.archHeight * 0.22 * gauss(u, .42, .12);
  }
  z += k * p.lateralSupport * gauss(u, .40, .13) * smooth(0.2, 1, -sn);
  const r = Math.hypot((u - .13) / .15, sn);
  z += k * p.heelCupDepth * smooth(.62, 1.08, r) * (1 - smooth(.2, .36, u));
  z += p.heelLift * (1 - smooth(.28, .55, u));
  const heelFade = 1 - smooth(.25, .42, u), rad = Math.PI / 180;
  z += Math.tan(p.medialPost * rad) * hw * (sn + 1) * 0.5 * heelFade;
  z += Math.tan(p.medialHeelSkive * rad) * hw * Math.max(0, sn) * heelFade * 0.6;
  z += Math.tan(p.lateralWedge * rad) * hw * (1 - sn) * 0.5 * (1 - smooth(.75, .95, u));
  if (p.lateralFlange) z += k * 7 * smooth(.68, 1, -sn) * smooth(.02, .1, u) * (1 - smooth(.52, .68, u));
  // met pad: dome just PROXIMAL to metatarsal heads 2-4 (heads at ~70-73% of length) -> apex ~66%
  if (p.metPad) { const cs = p.metPad === 'neuroma' ? -.22 : 0.05; z += k * 4.5 * Math.exp(-(((u - .655) / .04) ** 2 + ((sn - cs) / .28) ** 2)); }
  // Morton's extension: firm 1.5 mm extension under the 1st MTP joint + hallux (hallux limitus)
  if (p.mortonExtension) z += 1.5 * smooth(.66, .7, u) * smooth(.25, .45, sn);
  if (p.toeCrest) z += k * 4 * gauss(u, .825, .022) * (1 - smooth(.45, .8, Math.abs(sn + .08)));
  if (M?.archBoost) z += k * M.archBoost * gauss(u, .41, .1) * smooth(-0.2, 0.8, sn);
  let dep = 0;
  for (const r of M?.recesses || []) { const e = r.at === 'met' ? [.725, 0, .045, .72] : r.at === 'hallux' ? [.85, .5, .045, .32] : [.12, 0, .07, .45]; z -= r.depth * (1 - smooth(.55, 1, Math.hypot((u - e[0]) / e[2], (sn - e[1]) / e[3]))); }
  if (p.heelCutout || p.offloadPockets) dep = Math.max(dep, 1.5 * ellIn(u, sn, .12, 0, .06, .38));
  if (p.sesamoidCutout) dep = Math.max(dep, 1.5 * ellIn(u, sn, .70, .58, .04, .22));
  if (p.offloadPockets) dep = Math.max(dep, 1.1 * ellIn(u, sn, .715, 0, .045, .7));
  if (p.firstMTPRelief) dep = Math.max(dep, 1.0 * ellIn(u, sn, .73, .75, .06, .3));
  z -= dep;
  z -= smooth(.84, 1, Math.abs(sn)) * (M ? M.rim * 1.3 : p.noHardEdges ? 1.6 : 0.7) * (kind === 'insole' ? 1 : 0.6);
  if (M?.length === '3/4') { const uf = p._uMax || .78; z -= 0.6 * smooth(uf - .04, uf, u); }
  else if (kind === 'insole') z -= 1.2 * smooth(.9, 1, u) + 0.8 * smooth(.1, 0, u);
  if (M) z = Math.max(z, M.minTotal || 1.2); // v8.1: 2-layer models keep >= 2.4 mm total (each layer >= 1.2 mm), raised locally at the toe tip / edge
  return z;
}
function bottomHeight(u, p, kind) {
  if (kind === 'insole') return 0;
  const spring = (kind === 'slide' ? 5 : 4) + (p.rocker ? 9 : 0);
  return spring * smooth(.62, 1, u) ** 2 + 3 * smooth(.08, 0, u);
}
export function zoneHit(z, u, sn) {
  if (z.rect) return u >= z.rect.u[0] && u <= z.rect.u[1] && sn >= z.rect.s[0] && sn <= z.rect.s[1];
  const e = z.ellipse; return Math.hypot((u - e.cu) / e.ru, (sn - e.cs) / e.rs) <= 1;
}
const zoneArea = z => z.rect ? (z.rect.u[1] - z.rect.u[0]) * (z.rect.s[1] - z.rect.s[0]) : Math.PI * z.ellipse.ru * z.ellipse.rs;

export function buildSole(opts) { return buildSoleParam(opts); }
function buildSoleParam(opts) {
  let p = opts.params;
  const { L = 260, W = 100, kind = 'insole', side = 'R', zones = [], showZones = true, highlight = null, color = '#ffffff', integrate = true, uvMode = 'holes', flatBottom = false, openings = null } = opts;
  const mir = side === 'R' ? -1 : 1, NU = 120, NV = 36;
  const M = kind === 'insole' ? p._model : null, uMax = M?.length === '3/4' ? .72 + (M.frontMm ?? 6) / L : .997; // v7: 3/4 length ends past the met heads
  if (M) p = { ...p, _uMax: uMax, _scale: M.scaleWithSize ? Math.min(1, Math.max(.75, (L - 15) / 240)) : 1 };
  const zs = [...zones].sort((a, b) => zoneArea(b) - zoneArea(a));
  const base = new THREE.Color(color), tmp = new THREE.Color(), dark = base.clone().multiplyScalar(kind === 'insole' ? 0.92 : 0.78);
  const rows = [];
  for (let i = 0; i < NU; i++) {
    const t = i / (NU - 1), u = 0.003 + (uMax - 0.003) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    let { m, l } = outline(u, W, { extraFore: p.forefootExtraWidth || 0, lateralFlare: p.lateralFlare });
    if (uMax < .99) { const rf = .07, d = u - (uMax - rf); if (d > 0) { const f = Math.sqrt(Math.max(0.0004, 1 - (d / rf) ** 2)), c = (m + l) / 2; m = c + (m - c) * f; l = c + (l - c) * f; } } // rounded 3/4 front
    const hw = (m - l) / 2, bz = flatBottom ? 0 : bottomHeight(u, p, kind), row = [];
    for (let j = 0; j < NV; j++) {
      const sn = -1 + 2 * j / (NV - 1), s = l + (sn + 1) * hw;
      const tz = Math.max(bz + 1.2, bz + topHeight(u, sn, p, kind, hw, integrate));
      row.push({ u, ui: (u - 0.003) / (uMax - 0.003), sn, x: mir * s, y: (0.5 - u) * L, tz, bz });
    }
    rows.push(row);
  }
  const mk = () => ({ pos: [], col: [], uv: [], idx: [] });
  const top = mk(), bot = mk(), wall = mk();
  const push = (g, x, y, z, c, uu, vv) => { g.pos.push(x, y, z); g.col.push(c.r, c.g, c.b); g.uv.push(uu, vv); return g.pos.length / 3 - 1; };
  const topColor = (u, sn) => {
    tmp.copy(base);
    if (showZones) for (const z of zs) if ((z.id !== 'fullLength' || (highlight && highlight.includes('fullLength'))) && zoneHit(z, u, sn)) {
      const zc = new THREE.Color(z.color);
      const amt = highlight ? (highlight.includes(z.id) ? 0.85 : 0.08) : 0.42;
      tmp.copy(base).lerp(zc, amt);
    }
    return tmp;
  };
  for (const row of rows) for (const v of row) {
    const uu = (v.sn * mir + 1) / 2;
    push(top, v.x, v.tz, v.y, topColor(v.u, v.sn), uu, v.u);
    push(bot, v.x, v.bz, v.y, dark, uu, v.u);
  }
  for (let i = 0; i < NU - 1; i++) for (let j = 0; j < NV - 1; j++) {
    const a = i * NV + j, b = a + 1, c = a + NV, d = c + 1;
    top.idx.push(a, b, c, b, d, c); bot.idx.push(a, c, b, b, c, d);
  }
  // walls: one closed loop around the outline (medial edge, toe end, lateral edge, heel end) – no duplicate corners
  const edgeLoop = [];
  for (let i = 0; i < NU; i++) edgeLoop.push(rows[i][NV - 1]);
  for (let j = NV - 2; j >= 0; j--) edgeLoop.push(rows[NU - 1][j]);
  for (let i = NU - 2; i >= 0; i--) edgeLoop.push(rows[i][0]);
  for (let j = 1; j < NV - 1; j++) edgeLoop.push(rows[0][j]);
  const EL = edgeLoop.length;
  for (let k = 0; k < EL; k++) {
    const v = edgeLoop[k]; push(wall, v.x, v.tz, v.y, dark, k / EL, 1); push(wall, v.x, v.bz, v.y, dark, k / EL, 0);
  }
  for (let k = 0; k < EL; k++) { const a = 2 * k, b = a + 1, c = (2 * k + 2) % (2 * EL), d = c + 1; wall.idx.push(a, b, c, b, d, c); }
  const toGeo = g => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); geo.setIndex(g.idx); geo.computeVertexNormals(); return geo; };
  const geo = mergeGeometries([toGeo(top), toGeo(bot), toGeo(wall)], true);
  const mats = [];
  const common = { vertexColors: true, roughness: kind === 'insole' ? 0.55 : 0.75, metalness: 0, side: THREE.DoubleSide };
  if (uvMode === 'holes') { const t = holesTexture(); mats.push(new THREE.MeshStandardMaterial({ ...common, alphaMap: t, alphaTest: 0.5 }), new THREE.MeshStandardMaterial({ ...common, alphaMap: t, alphaTest: 0.5 })); }
  else if (uvMode === 'hex') { const t = hexTexture(false).clone(); t.needsUpdate = true; t.repeat.set(2.2, 5.5); mats.push(new THREE.MeshStandardMaterial({ ...common, map: t }), new THREE.MeshStandardMaterial(common)); }
  else mats.push(new THREE.MeshStandardMaterial(common), new THREE.MeshStandardMaterial(common));
  mats.push(new THREE.MeshStandardMaterial(common));
  const mesh = new THREE.Mesh(geo, mats); mesh.name = 'sole';
  if (openings) { // v6: real holes / lattice in the geometry (preview == STL)
    const res = buildOpenSole(rowSampler(rows, 'y'), { ...openings, allow: openings.allow || defaultAllow(openings.mode, p, .72), colorAt: (u, sn) => topColor(u, sn).clone(), dark });
    mesh.geometry.dispose(); mesh.geometry = res.geometry; mesh.material = [0, 1, 2].map(() => new THREE.MeshStandardMaterial(common));
    mesh.userData.openings = res.stats;
  }
  mesh.userData.rows = rows; mesh.userData.lenKey = 'y'; // v8: 2-material split re-meshes from the row grid
  mesh.userData.surfaceAt = (u, sn) => { // helper for straps / uppers
    const i = Math.round((Math.acos(1 - 2 * Math.min(1, Math.max(0, (u - .003) / .994))) / Math.PI) * (NU - 1));
    const j = Math.round((sn + 1) / 2 * (NV - 1)); const v = rows[Math.min(NU - 1, Math.max(0, i))][Math.min(NV - 1, Math.max(0, j))];
    return new THREE.Vector3(v.x, v.tz, v.y);
  };
  return mesh;
}

// ---------- products ----------
export function buildProduct(product, opts) {
  const g = new THREE.Group();
  const { color, strapColor = '#d8c6a8' } = opts;
  const buildSole = opts.soleFn || buildSoleParam; // scan-based total-contact sole when available
  const op = opts.openings || null; // v6: openings are real geometry; no fake alpha textures (preview must match the STL)
  if (product.id === 'perforated') g.add(buildSole({ ...opts, kind: 'insole', uvMode: 'none', openings: op?.mode === 'holes' ? op : null, params: { ...opts.params, _thick: 2.2 } }));
  else if (product.id === 'fullcontact') g.add(buildSole({ ...opts, kind: 'insole', uvMode: 'none', params: { ...opts.params, _thick: 3.6 } }));
  else if (product.model) g.add(buildSole({ ...opts, kind: 'insole', uvMode: 'none', openings: op?.mode === 'holes' ? op : null, params: { ...opts.params, _model: product.model } })); // v7 line
  else if (product.id === 'flipflop') {
    const sole = buildSole({ ...opts, kind: 'flipflop', uvMode: 'none' }); g.add(sole);
    const S = sole.userData.surfaceAt, A = sole.userData.anchors, post = A ? A.post.clone() : S(.8, .32);
    const mat = new THREE.MeshStandardMaterial({ color: strapColor, roughness: .6 });
    const apex = post.clone().add(new THREE.Vector3(0, 16, 0));
    for (const sn of [1.0, -1.0]) {
      const end = A ? (sn > 0 ? A.endM : A.endL).clone() : S(.52, sn); end.y += 1; const mid = A ? (sn > 0 ? A.midM : A.midL).clone() : S(.64, sn * 0.8); mid.y += 26;
      const curve = new THREE.CatmullRomCurve3([apex, mid, end]);
      const tube = new THREE.TubeGeometry(curve, 40, 4.6, 12, false); tube.scale(1, 0.75, 1); tube.scale(1, 1, 1);
      g.add(new THREE.Mesh(tube, mat));
    }
    const pg = new THREE.CylinderGeometry(3, 3.6, 16, 14); pg.translate(post.x, post.y + 8, post.z); g.add(new THREE.Mesh(pg, mat));
    const badge = new THREE.BoxGeometry(14, 3, 8); badge.translate(apex.x, apex.y + 1, apex.z); g.add(new THREE.Mesh(badge, new THREE.MeshStandardMaterial({ color: '#555', metalness: .6, roughness: .3 })));
  } else if (product.id === 'slide') {
    const sole = buildSole({ ...opts, kind: 'slide', uvMode: 'none', openings: op?.mode === 'lattice' ? op : null }); g.add(sole);
    const S = sole.userData.surfaceAt; const NA = 40, NB = 26, pos = [], uv = [], idx = [];
    for (let a = 0; a < NA; a++) for (let b = 0; b < NB; b++) {
      const u = .40 + .42 * a / (NA - 1), tt = b / (NB - 1), sn = -1 + 2 * tt;
      const pM = S(u, 1), pL = S(u, -1), p = pL.clone().lerp(pM, tt);
      const H = (46 - 26 * (u - .4) / .42) * Math.sin(Math.PI * tt);
      const out = 6 * Math.sin(Math.PI * tt) ** 0.5 * (1 - Math.abs(sn)) ; // bulge
      p.y += 2 + H; p.x += Math.sign(pM.x - pL.x) * (sn * 4);
      pos.push(p.x, p.y, p.z); uv.push(tt * 3, a / (NA - 1) * 2.2);
    }
    for (let a = 0; a < NA - 1; a++) for (let b = 0; b < NB - 1; b++) { const i = a * NB + b; idx.push(i, i + 1, i + NB, i + 1, i + NB + 1, i + NB); }
    const ug = new THREE.BufferGeometry(); ug.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ug.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); ug.setIndex(idx); ug.computeVertexNormals();
    const at = hexTexture(true).clone(); at.needsUpdate = true; at.wrapS = at.wrapT = THREE.RepeatWrapping; at.generateMipmaps = false; at.minFilter = THREE.LinearFilter;
    g.add(new THREE.Mesh(ug, new THREE.MeshStandardMaterial({ color, roughness: .7, side: THREE.DoubleSide, alphaMap: at, alphaTest: .5 })));
  }
  return g;
}

// ---------- uploaded mesh ----------
export function processUploaded(object, filename) {
  const geoms = [];
  object.traverse ? object.traverse(o => { if (o.isMesh) { const gg = o.geometry.clone(); o.updateMatrixWorld(); gg.applyMatrix4(o.matrixWorld); geoms.push(gg); } }) : geoms.push(object);
  if (!geoms.length) throw new Error('No mesh found in file');
  const clean = geoms.map(g => { const n = g.index ? g.toNonIndexed() : g; const out = new THREE.BufferGeometry(); out.setAttribute('position', n.attributes.position.clone()); return out; });
  let geo = clean.length > 1 ? mergeGeometries(clean) : clean[0];
  geo.computeBoundingBox();
  const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
  const dims = [size.x, size.y, size.z], axes = ['x', 'y', 'z'];
  const lenAx = dims.indexOf(Math.max(...dims));
  const isSTL = /\.stl$/i.test(filename);
  let upAx = isSTL ? 2 : 1; if (upAx === lenAx) upAx = isSTL ? 1 : 2;
  const widAx = [0, 1, 2].find(a => a !== lenAx && a !== upAx);
  let unit = 1; const maxD = dims[lenAx]; if (maxD < 1) unit = 1000; else if (maxD < 50) unit = 10;
  const P = geo.attributes.position, n = P.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = [P.getX(i), P.getY(i), P.getZ(i)]; arr[i * 3] = v[widAx] * unit; arr[i * 3 + 1] = v[upAx] * unit; arr[i * 3 + 2] = v[lenAx] * unit; }
  geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.computeBoundingBox(); const bb = geo.boundingBox, c = new THREE.Vector3(); bb.getCenter(c);
  geo.translate(-c.x, -bb.min.y, -c.z); geo.computeBoundingBox();
  const bb2 = geo.boundingBox, L = bb2.max.z - bb2.min.z, H = bb2.max.y;
  // contact band analysis (Chippaux-Smirak index)
  const band = Math.max(3, H * 0.04), BINS = 40, minX = new Array(BINS).fill(Infinity), maxX = new Array(BINS).fill(-Infinity);
  for (let i = 0; i < n; i++) { const y = arr[i * 3 + 1]; if (y > band) continue; const z = geo.attributes.position.getZ(i); const b = Math.min(BINS - 1, Math.floor((z - bb2.min.z) / L * BINS)); const x = geo.attributes.position.getX(i); minX[b] = Math.min(minX[b], x); maxX[b] = Math.max(maxX[b], x); }
  const wid = minX.map((m, i) => isFinite(m) ? maxX[i] - m : 0);
  const endW = (a, b) => Math.max(...wid.slice(a, b));
  let flip = endW(0, 8) > endW(BINS - 8, BINS); // toes are the wider end -> want toes at -z (u=1)
  if (flip) { geo.rotateY(Math.PI); wid.reverse(); }
  // now bins go from -z (toe) to +z (heel): u = 1 - b/BINS
  const at = u => wid[Math.min(BINS - 1, Math.max(0, Math.floor((1 - u) * BINS)))];
  const fore = Math.max(...[.62, .66, .7, .74, .78, .82].map(at)), mid = Math.min(...[.36, .4, .44, .48, .52, .56].map(at));
  const csi = fore > 0 ? Math.round(mid / fore * 100) : 35;
  const width = Math.max(...wid.filter(Boolean), bb2.max.x - bb2.min.x > 0 ? 0 : 0) || (bb2.max.x - bb2.min.x);
  // colour by height above floor (pressure look)
  const cc = new THREE.Color(), skin = new THREE.Color('#d8e6e3'), col = new Float32Array(n * 3), Pp = geo.attributes.position;
  for (let i = 0; i < n; i++) { const y = Pp.getY(i); const t = 1 - Math.min(1, y / Math.max(8, H * 0.12)); heatColor(t * 0.95, cc); cc.lerp(skin, y > Math.max(8, H * 0.12) ? 1 : 0.15); col.set([cc.r, cc.g, cc.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .65, side: THREE.DoubleSide })); mesh.name = 'uploaded';
  return { mesh, length: Math.round(L), width: Math.round(width), height: Math.round(H), csi, unitScale: unit, triangles: Math.round(n / 3) };
}

// v8: row grid of the printable (flat-bottom) parametric sole – input for the 2-material split
export function printableRows(product, opts) {
  const m = buildSoleParam({ ...opts, kind: 'insole', uvMode: 'none', zones: [], showZones: false, flatBottom: true, openings: null, params: { ...opts.params, ...(product.model ? { _model: opts.model || product.model } : {}) } });
  return { rows: m.userData.rows, lenKey: 'y' };
}
// ---------- printable export (closed manifold, mm, Z up, flat bottom on Z=0) ----------
export function buildPrintableSole(product, opts) {
  const kind = product.kind === 'insole' ? 'insole' : product.kind;
  const thick = product.id === 'perforated' ? 2.2 : product.id === 'fullcontact' ? 3.6 : undefined;
  const mesh = buildSole({ ...opts, kind, uvMode: 'none', zones: [], showZones: false, flatBottom: true, params: { ...opts.params, _thick: thick, ...(product.model ? { _model: product.model } : {}) } });
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', mesh.geometry.attributes.position.clone());
  g.setIndex(mesh.geometry.index.clone());
  g = mergeVertices(g, 1e-4);                       // share vertices -> real manifold topology
  g.rotateX(Math.PI / 2);                           // three.js Y-up -> STL Z-up (rotation keeps winding)
  g.computeBoundingBox(); g.translate(0, 0, -g.boundingBox.min.z);   // flat bottom exactly on Z = 0
  // make all normals point outward (mirroring for the right foot flips winding)
  const P = g.attributes.position, I = g.index.array; let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < I.length; i += 3) { a.fromBufferAttribute(P, I[i]); b.fromBufferAttribute(P, I[i + 1]); c.fromBufferAttribute(P, I[i + 2]); vol += a.dot(b.cross(c)) / 6; }
  if (vol < 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.index.needsUpdate = true; vol = -vol; }
  g.computeVertexNormals(); g.computeBoundingBox();
  const bb = g.boundingBox;
  const out = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  if (mesh.userData.openings) out.userData.openings = mesh.userData.openings;
  out.userData.stats = { volumeMm3: Math.round(vol), triangles: I.length / 3, sizeMm: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map(v => +v.toFixed(1)) };
  return out;
}

// ---------- Template mode: adapt a real Fixifoot insole model (watertight STL, mm, Z-up) ----------
// Scales the template to the customer's size and adds the rule-engine modifications (arch, met pad,
// heel lift, posting, flange, toe crest...) as a height offset on the TOP surface only, so the mesh
// stays closed/watertight. Returns a Z-up geometry (for STL) – rotate -90° about X to show in three.js.
const NEUTRAL = { archHeight: 12, lateralSupport: 2, heelCupDepth: 12, heelLift: 0, medialPost: 0, medialHeelSkive: 0, lateralWedge: 0, fullContact: false, lateralFlange: false, metPad: null, toeCrest: false, noHardEdges: false };
export function adaptTemplate(srcGeo, { footL, W, params, side = 'R', templateFootL = 254, zones = [], showZones = false, highlight = null, color = '#c8784a', fullLengthTemplate = true }) {
  let g = new THREE.BufferGeometry(); g.setAttribute('position', srcGeo.attributes.position.clone());
  g = mergeVertices(g, 1e-4); g.computeBoundingBox();
  const bb = g.boundingBox, P = g.attributes.position, n = P.count;
  const Lt = bb.max.x - bb.min.x, Wt = bb.max.y - bb.min.y;
  // heel = narrower end (sample widths near both ends)
  const endWidth = (a, b) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { const t = (P.getX(i) - bb.min.x) / Lt; if (t >= a && t <= b) { lo = Math.min(lo, P.getY(i)); hi = Math.max(hi, P.getY(i)); } } return hi - lo; };
  const heelAtMin = endWidth(0.02, 0.1) < endWidth(0.9, 0.98);
  const uOf = x => { const t = (x - bb.min.x) / Lt; return heelAtMin ? t : 1 - t; };
  // template spans u 0..1 of its own length; a 3/4 insole covers ~0..0.75 of the foot
  const coverage = fullLengthTemplate ? 1 : 0.74;
  // per-u width bins + which side is medial (higher top in the arch area)
  const BINS = 50, lo = new Array(BINS).fill(Infinity), hi = new Array(BINS).fill(-Infinity);
  for (let i = 0; i < n; i++) { const b = Math.min(BINS - 1, Math.floor(uOf(P.getX(i)) * BINS)); lo[b] = Math.min(lo[b], P.getY(i)); hi[b] = Math.max(hi[b], P.getY(i)); }
  g.computeVertexNormals(); const N = g.attributes.normal;
  let zPlus = 0, zMinus = 0, cP = 0, cM = 0;
  for (let i = 0; i < n; i++) { const u = uOf(P.getX(i)) * coverage; if (u < 0.32 || u > 0.55 || N.getZ(i) < 0.4) continue; const b = Math.min(BINS - 1, Math.floor(uOf(P.getX(i)) * BINS)); const mid = (lo[b] + hi[b]) / 2; if (P.getY(i) > mid) { zPlus += P.getZ(i); cP++; } else { zMinus += P.getZ(i); cM++; } }
  const medialIsPlusY = (zPlus / (cP || 1)) > (zMinus / (cM || 1));
  // size: uniform scale by foot length, width corrected by the scan width ratio
  const s = footL / templateFootL, sw = s * Math.min(1.15, Math.max(0.87, W / (footL * 0.39 + 4)));
  const mod = { ...NEUTRAL, ...params }, base = { ...NEUTRAL };
  const col = new Float32Array(n * 3), cBase = new THREE.Color(color), tmp = new THREE.Color();
  const zs = [...zones].sort((a, b) => (b.rect ? (b.rect.u[1] - b.rect.u[0]) * 2 : 0.1) - (a.rect ? (a.rect.u[1] - a.rect.u[0]) * 2 : 0.1));
  const arr = P.array;
  for (let i = 0; i < n; i++) {
    const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    const ut = uOf(x), u = ut * coverage, b = Math.min(BINS - 1, Math.floor(ut * BINS));
    const half = Math.max(1, (hi[b] - lo[b]) / 2), mid = (lo[b] + hi[b]) / 2;
    let sn = (y - mid) / half; if (!medialIsPlusY) sn = -sn; sn = Math.max(-1, Math.min(1, sn));
    let dz = 0;
    if (N.getZ(i) > 0.35) { // top surface only
      dz = topHeight(u, sn, mod, 'insole', half * s, true) - topHeight(u, sn, base, 'insole', half * s, true);
      dz = Math.max(0, dz) * smooth(1, 0.85, Math.abs(sn)) ** 0.5; // only add material, fade at the rim
    }
    arr[i * 3] = (x - bb.min.x) * s; arr[i * 3 + 1] = (y - (bb.min.y + bb.max.y) / 2) * sw * (side === 'L' ? -1 : 1); arr[i * 3 + 2] = z + dz;
    tmp.copy(cBase);
    if (showZones) for (const zn of zs) if ((zn.id !== 'fullLength' || (highlight && highlight.includes('fullLength'))) && zoneHit(zn, u, sn)) tmp.copy(cBase).lerp(new THREE.Color(zn.color), highlight ? (highlight.includes(zn.id) ? 0.85 : 0.1) : 0.5);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  if (side === 'L') { const I = g.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  P.needsUpdate = true; g.computeBoundingBox(); g.translate(-(g.boundingBox.min.x + g.boundingBox.max.x) / 2, 0, -g.boundingBox.min.z);
  g.computeVertexNormals(); g.computeBoundingBox();
  const I = g.index.array, a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3(); let vol = 0;
  for (let i = 0; i < I.length; i += 3) { a.fromBufferAttribute(g.attributes.position, I[i]); b2.fromBufferAttribute(g.attributes.position, I[i + 1]); c.fromBufferAttribute(g.attributes.position, I[i + 2]); vol += a.dot(b2.cross(c)) / 6; }
  const bbx = g.boundingBox;
  g.userData = { stats: { volumeMm3: Math.round(Math.abs(vol)), triangles: I.length / 3, sizeMm: [bbx.max.x - bbx.min.x, bbx.max.y - bbx.min.y, bbx.max.z - bbx.min.z].map(v => +v.toFixed(1)) }, heelAtMin, medialIsPlusY };
  return g;
}

// ---------- realistic scanned-foot mesh (CC0 Blender Studio foot, see assets/foot-scan.js) ----------
let scanBase = null;
function b64ToBytes(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
function getScanBase() {
  if (scanBase) return scanBase;
  const d = typeof window !== 'undefined' && window.__FX_FOOTSCAN; if (!d) return null;
  const q = new Int16Array(b64ToBytes(d.pos)), idx = new Uint16Array(b64ToBytes(d.idx)), pos = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) pos[i] = q[i] / d.q;
  return (scanBase = { pos, idx, Wn: d.W / d.L });
}
export const hasScanFoot = () => !!getScanBase();
// plantar arch change (mm) relative to the base scan, which has a normal arch (apex ~41% of length from the heel = navicular)
const SCAN_ARCH_DELTA = { high: 7, normal: 0, low: -3.5, flat: -6.5 };
const SKIN = new THREE.Color('#e3b69c'), SKIN_D = new THREE.Color('#c98f72');
export function buildFoot(opts) {
  const B = getScanBase(); if (!B) return buildFootProcedural(opts);
  const { L = 260, W = 100, archType = 'normal', side = 'R', peak = 0.8 } = opts;
  const n = B.pos.length / 3, pos = new Float32Array(n * 3), mir = side === 'L' ? -1 : 1;
  const kx = W / (B.Wn * L), ky = 0.55 + 0.45 * kx, dA = SCAN_ARCH_DELTA[archType] ?? 0;
  for (let i = 0; i < n; i++) {
    const x0 = B.pos[i * 3] * L, y0 = B.pos[i * 3 + 1] * L, z = B.pos[i * 3 + 2] * L;
    const u = 0.5 - z / L, sn = Math.max(-1, Math.min(1, -x0 / (0.5 * B.Wn * L)));
    let y = y0 * ky;
    if (dA) {
      const w = gauss(u, 0.41, 0.12) * smooth(-0.25, 0.75, sn) * Math.exp(-Math.max(0, y - 2) / 24);
      y = dA > 0 ? y + dA * w : Math.max(Math.min(y, 0.25), y + dA * w);
    }
    pos[i * 3] = mir * x0 * kx; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  }
  const idx = mir < 0 ? B.idx.slice().reverse() : B.idx; // mirroring flips winding
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1)); g.computeVertexNormals();
  // skin + plantar pressure colours
  const skin = new Float32Array(n * 3), heat = new Float32Array(n * 3), cc = new THREE.Color(), sc = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] * mir, y = pos[i * 3 + 1], z = pos[i * 3 + 2], u = 0.5 - z / L;
    const sn = Math.max(-1, Math.min(1, -x / (0.5 * W)));
    sc.copy(SKIN).lerp(SKIN_D, 0.35 * (1 - smooth(0, 14, y)) + 0.12 * Math.max(0, Math.sin(i * 12.9898) * 0.5)); // a little scan-like variation, darker sole
    skin.set([sc.r, sc.g, sc.b], i * 3);
    const contact = Math.exp(-Math.max(0, y - 0.8) / 2.4);
    const pr = (contactAt(u, sn, archType) || u > 0.8) ? pressureAt(u, sn, archType, peak) : 0.05;
    heatColor(pr, cc); cc.lerp(sc, 1 - contact * 0.95); heat.set([cc.r, cc.g, cc.b], i * 3);
  }
  return wrapFoot(g, skin, heat);
}
// common foot presentation: solid skin mesh + optional pressure colours, wireframe and point-cloud "scan" look
export function wrapFoot(g, skin, heat) {
  g.setAttribute('color', new THREE.BufferAttribute(heat.slice(), 3));
  const solid = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, transparent: false }));
  const wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x015ad8, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false }));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x33b5ff, size: 1.5, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }));
  wire.visible = pts.visible = false; wire.renderOrder = pts.renderOrder = 2;
  const grp = new THREE.Group(); grp.add(solid, wire, pts); grp.name = 'foot';
  grp.userData.look = (o = {}) => {
    const col = g.attributes.color; col.array.set(o.heat ? heat : skin); col.needsUpdate = true;
    wire.visible = !!o.wire; pts.visible = !!o.scan;
    solid.material.transparent = !!o.scan; solid.material.opacity = o.scan ? 0.35 : 1; solid.material.depthWrite = !o.scan; solid.material.needsUpdate = true;
  };
  grp.userData.shimmer = t => { if (pts.visible) pts.material.opacity = 0.55 + 0.35 * Math.sin(t * 3.2); };
  return grp;
}

// ---------- total contact: plantar height map from a real (uploaded) foot scan ----------
// Returns f(u, sn) -> plantar surface height (mm) above the lowest point, smoothed, or null.
export function plantarGridFromScan(geo) {
  const P = geo.attributes.position, n = P.count; geo.computeBoundingBox();
  const bb = geo.boundingBox, L = bb.max.z - bb.min.z, NU = 48, NS = 24;
  const lo = new Array(NU).fill(Infinity), hi = new Array(NU).fill(-Infinity);
  const floorY = bb.min.y, band = 40;
  for (let i = 0; i < n; i++) { const y = P.getY(i) - floorY; if (y > band) continue; const u = (bb.max.z - P.getZ(i)) / L, b = Math.min(NU - 1, Math.max(0, Math.floor(u * NU))); lo[b] = Math.min(lo[b], P.getX(i)); hi[b] = Math.max(hi[b], P.getX(i)); }
  const grid = Array.from({ length: NU }, () => new Array(NS).fill(Infinity));
  for (let i = 0; i < n; i++) {
    const y = P.getY(i) - floorY; if (y > band) continue;
    const u = (bb.max.z - P.getZ(i)) / L, b = Math.min(NU - 1, Math.max(0, Math.floor(u * NU)));
    const w = hi[b] - lo[b]; if (!(w > 0)) continue;
    const t = (P.getX(i) - lo[b]) / w, j = Math.min(NS - 1, Math.max(0, Math.floor(t * NS)));
    grid[b][j] = Math.min(grid[b][j], y);
  }
  // which x side is medial: the side with the higher plantar surface in the midfoot
  let a = 0, c = 0; for (let b = Math.floor(NU * .35); b < NU * .55; b++) { for (let j = 0; j < 6; j++) { if (isFinite(grid[b][j])) a += grid[b][j]; if (isFinite(grid[b][NS - 1 - j])) c += grid[b][NS - 1 - j]; } }
  const medialAtHighX = c > a;
  // fill holes + smooth (3 passes) so scan noise doesn't print
  for (let pass = 0; pass < 4; pass++) {
    const g2 = grid.map(r => r.slice());
    for (let b = 0; b < NU; b++) for (let j = 0; j < NS; j++) {
      let s = 0, k = 0; for (let db = -1; db <= 1; db++) for (let dj = -1; dj <= 1; dj++) { const v = grid[b + db]?.[j + dj]; if (v !== undefined && isFinite(v)) { s += v; k++; } }
      g2[b][j] = k ? (isFinite(grid[b][j]) && pass > 0 ? (grid[b][j] + s / k) / 2 : s / k) : Infinity;
    }
    for (let b = 0; b < NU; b++) grid[b] = g2[b];
  }
  return { NU, NS, medialAtHighX, grid: grid.map(r => r.map(v => (isFinite(v) ? Math.round(v * 10) / 10 : 0))) };
}
// f(u, sn) -> plantar height (mm); grid is small enough to store with the customer record (re-order without rescanning)
export function plantarFn(pg) {
  if (!pg || !pg.grid) return null;
  const { NU, NS, grid, medialAtHighX } = pg;
  return (u, sn) => {
    const t = medialAtHighX ? (sn + 1) / 2 : (1 - sn) / 2;
    const fb = Math.min(NU - 1.001, Math.max(0, u * NU - 0.5)), fj = Math.min(NS - 1.001, Math.max(0, t * NS - 0.5));
    const b0 = Math.floor(fb), j0 = Math.floor(fj), tb = fb - b0, tj = fj - j0;
    const v = (b, j) => grid[b][j] || 0;
    const h = (v(b0, j0) * (1 - tj) + v(b0, j0 + 1) * tj) * (1 - tb) + (v(b0 + 1, j0) * (1 - tj) + v(b0 + 1, j0 + 1) * tj) * tb;
    return Math.min(30, Math.max(0, h));
  };
}
