// Fixifoot – UI / flow
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { TrackballControls } from 'three/addons/TrackballControls.js';
import { STLLoader } from 'three/addons/STLLoader.js';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { PLYLoader } from 'three/addons/PLYLoader.js';
import { STLExporter } from 'three/addons/STLExporter.js';
import { toCreasedNormals } from 'three/addons/BufferGeometryUtils.js';
import { loadEngraver, engraverReady, planText, engraveBodies, cleanText, measureText, ensureClosed, TEXT_RULES } from './engrave.js';
import { buildFoot, buildProduct, buildPrintableSole, printableRows, drawFootprint, adaptTemplate, wrapFoot, heatColor } from './geometry.js';
import { OPENING_PRESETS, HOLE_DIAMETERS, defaultAllow } from './openings.js';
import { buildTwoMaterial, bodiesToPrint, build3MF, zipStore } from './multi.js';
import { Cloud, initCloud, pingCloud, updateOrderPaymentCloud, updateOrderStatusCloud, scanSig, signedUrl, onCloudChange, signIn, signUp, signOut, resetPassword, fetchCustomers, saveCustomerCloud, insertOrderCloud, deleteCustomerCloud, listStaff, setRole } from './cloud.js';
import { PAY_METHODS, bizSettings, saveBizSettings, bizConfigured, buildReceiptPdf, downloadBlob, shareBlob, printBlob } from './receipt.js';
import { alignScan, rasterizePlantar, deriveModel, encodeGrid, decodeGrid, buildContactSole, morphTemplate, toPrintable, fitCheck, colorByGap, drawFitMap, ALLOW } from './fit.js';

const R = window.FixiRules;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const SCREENS_ALL = ['s-crm'];
const SCREENS = ['s-welcome', 's-catalog', 's-design', 's-summary', 's-scan', 's-preview', 's-analysis', 's-health', 's-products', 's-result', 's-order'];
const peso = n => '₱' + n.toLocaleString('en-PH');

const state = {
  side: 'R', feet: {}, archOverride: {}, uploaded: {},
  answers: { diabetes: 'no', heelPain: 'no', jointPain: 'no', standing: '0-4', activity: 'moderate', weight: '60-90', lldMm: 5, lldSide: 'left' },
  conditions: new Set(), sources: {}, qa: {}, qIndex: 0, staffAdds: new Set(), staffRemoves: new Set(), staff: sessionStorage.getItem('fxStaff') === '1' && !(window.FIXI_CLOUD?.url && window.FIXI_CLOUD?.anonKey),
  sizeMode: 'scan', base: '', product: null, color: null, strapColor: null, integrate: true, showZones: true, highlight: null,
  history: ['s-welcome'], lastParams: null,
  look: { heat: true, wire: false, scan: false }, previewSide: 'both', totalContact: true, customerId: null, archFill: null, rawScans: {}, nudge: {}, alignSide: 'R', fitSide: 'R',
  twoMat: true, // v8: show the 2-material split (both bodies in their colours) for the insole line
  openings: { on: true, density: 'med', d: 3.5 }, // v6: real ventilation holes (perforated) / lattice (slide) in preview + STL
  design: null // v9: { productId, colors: { base, top } (palette ids), text, size, keptSuggestion } – chosen BEFORE the scan
};
window.__fixifoot = state; // handy for debugging

/* ---------------- 3D viewer ---------------- */
class Viewer {
  constructor(el, opts = {}) {
    this.el = el; this.free = !!opts.free; this.labels = []; this.tween = null;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    if (this.free) {
      // full 360° in every direction (incl. straight under the sole): trackball, no polar limits
      this.controls = new TrackballControls(this.camera, this.renderer.domElement);
      Object.assign(this.controls, { rotateSpeed: 3.2, zoomSpeed: 1.1, noPan: true, staticMoving: false, dynamicDampingFactor: 0.12, minDistance: 110, maxDistance: 1500 });
      this.autoSpin = true;
      this.controls.addEventListener('start', () => { this.autoSpin = false; this.tween = null; el.classList.add('interacted'); el.dispatchEvent(new CustomEvent('viewchange', { detail: 'free' })); });
    } else {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      Object.assign(this.controls, { enableDamping: true, enablePan: false, autoRotate: true, autoRotateSpeed: 1.2, minDistance: 150, maxDistance: 1200, minPolarAngle: 0, maxPolarAngle: Math.PI });
      this.controls.addEventListener('start', () => (this.controls.autoRotate = false));
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d8e6, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(200, 400, 250); this.scene.add(d);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.6); d2.position.set(-300, 150, -200); this.scene.add(d2);
    const d3 = new THREE.DirectionalLight(0xffffff, this.free ? 0.7 : 0.25); d3.position.set(80, -400, -120); this.scene.add(d3); // light the sole from below
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(10,40,80,.26)'); gr.addColorStop(1, 'rgba(10,40,80,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.scene.add(this.shadow);
    new ResizeObserver(() => this.resize()).observe(el); this.resize();
    const v = new THREE.Vector3();
    const loop = t => {
      requestAnimationFrame(loop);
      if (this.el.offsetParent === null) return;
      if (this.free && this.obj) {
        if (this.autoSpin) this.obj.rotation.y += 0.0065;
        if (this.tween) {
          const k = Math.min(1, (performance.now() - this.tween.t0) / 550), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e); this.camera.up.lerpVectors(this.tween.u0, this.tween.u1, e).normalize();
          this.obj.rotation.y = this.tween.r0 * (1 - e); this.camera.lookAt(this.controls.target);
          if (k >= 1) this.tween = null;
        }
        this.obj.traverse(o => o.userData.shimmer && o.userData.shimmer(t / 1000));
      }
      if (!this.tween) this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this.labels.length && this.obj) for (const L of this.labels) {
        v.copy(L.pos).applyMatrix4(this.obj.matrixWorld).project(this.camera);
        L.el.style.transform = `translate(-50%,-50%) translate(${(v.x * .5 + .5) * this.el.clientWidth}px,${(-v.y * .5 + .5) * this.el.clientHeight}px)`;
        L.el.style.opacity = v.z < 1 ? 1 : 0;
      }
    };
    requestAnimationFrame(loop);
  }
  resize() { const w = this.el.clientWidth || 300, h = this.el.clientHeight || 300; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); if (this.free) this.controls.handleResize(); }
  setLabels(list) {
    this.labels.forEach(L => L.el.remove());
    this.labels = list.map(({ text, pos }) => { const el = document.createElement('span'); el.className = 'v-label'; el.textContent = text; this.el.appendChild(el); return { el, pos }; });
  }
  set(obj, keepView = false, view = 'top') {
    if (this.obj) { this.scene.remove(this.obj); this.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    this.obj = obj; this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    this.shadow.scale.set(size.x * 1.6, size.z * 1.25, 1); this.shadow.position.set(ctr.x, box.min.y - 0.5, ctr.z);
    if (this.free) { this.home = ctr.clone(); this.radius = box.getBoundingSphere(new THREE.Sphere()).radius; if (!keepView) this.view('iso', false); this.autoSpin = !keepView; return; }
    if (!keepView) {
      const r = Math.max(size.x, size.y, size.z);
      this.controls.target.set(ctr.x, ctr.y * 0.6, ctr.z);
      if (view === 'sole') this.camera.position.set(ctr.x + r * 1.0, ctr.y - r * 0.95, ctr.z + r * 1.4);
      else this.camera.position.set(ctr.x + r * 0.78, ctr.y + r * 0.88, ctr.z + r * 1.05);
      this.shadow.visible = view !== 'sole';
      this.controls.autoRotate = true;
    }
    this.controls.update();
  }
  // preset camera views for the free (trackball) viewer. medialX = which x direction is the inside of the foot
  view(name, animate = true, medialX = -1) {
    if (!this.obj) return;
    const D = { iso: [[0.16, 1, 0.5], [0, 1, 0]], // v8.2: default 3/4 view from behind/above (the person's own view: Left foot left, big toes inside)
       top: [[0, 1, 0.0001], [0, 0, -1]], bottom: [[0, -1, 0.0001], [0, 0, -1]], inside: [[medialX, 0.08, 0], [0, 1, 0]], outside: [[-medialX, 0.08, 0], [0, 1, 0]], back: [[0, 0.12, 1], [0, 1, 0]], front: [[0, 0.12, -1], [0, 1, 0]] }[name] || [[0.16, 1, 0.5], [0, 1, 0]];
    const dir = new THREE.Vector3(...D[0]).normalize(), up = new THREE.Vector3(...D[1]);
    const fit = this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (this.camera.aspect < 1 ? 1.0 / Math.max(.62, this.camera.aspect) * 0.8 : 0.95);
    const p1 = this.home.clone().addScaledVector(dir, fit);
    this.controls.target.copy(this.home); this.autoSpin = false;
    if (!animate) { this.camera.position.copy(p1); this.camera.up.copy(up); this.obj.rotation.y = 0; this.camera.lookAt(this.home); this.tween = null; return; }
    this.tween = { t0: performance.now(), p0: this.camera.position.clone(), p1, u0: this.camera.up.clone(), u1: up, r0: ((this.obj.rotation.y + Math.PI) % (2 * Math.PI)) - Math.PI };
  }
}
let footViewer, productViewer;

/* ---------------- navigation ---------------- */
function show(id, push = true) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (push && state.history[state.history.length - 1] !== id) state.history.push(id);
  const step = SCREENS.indexOf(id);
  $('#stepsFill').style.width = (step < 0 ? 100 : step / (SCREENS.length - 1) * 100) + '%';
  $('#backBtn').classList.toggle('hide', id === 's-welcome'); document.body.classList.toggle('on-staff', ['s-staff', 's-align', 's-fit'].includes(id)); document.body.classList.toggle('on-welcome', id === 's-welcome'); renderBanner();
  window.scrollTo(0, 0);
  onEnter[id]?.(); syncTestMode();
}
$('#backBtn').onclick = () => { if ($('#s-health').classList.contains('active') && prevQuestion()) return; if (state.history.length > 1) { state.history.pop(); show(state.history[state.history.length - 1], false); } };
$$('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));

function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
function sheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').classList.remove('hidden'); }
$('#sheetClose').onclick = () => $('#sheet').classList.add('hidden');
$('#sheet').onclick = e => { if (e.target.id === 'sheet') $('#sheet').classList.add('hidden'); };

/* ---------------- helpers ---------------- */
const sideName = s => (s === 'L' ? 'Left' : 'Right');
const archOf = side => state.archOverride[side] || state.feet[side]?.archType || Object.values(state.feet)[0]?.archType || 'normal';
function sizeFromLength(L) { const eu = Math.round((L / 10 + 1.5) * 1.5); return { eu, usM: eu - 33, usW: +(eu - 31.5).toFixed(1) }; }
function lengthFromEU(eu) { return Math.round((eu / 1.5 - 1.5) * 10); }
// product outline dimensions in mm (scan or chosen shoe size) – insole/sole is a bit longer than the foot
function productDims(side) {
  const f = state.feet[side] || mainFoot() || genericFoot();
  const footL = state.sizeMode === 'scan' ? f.length : lengthFromEU(+state.sizeMode);
  const footW = state.sizeMode === 'scan' ? f.width : Math.round(footL * f.width / f.length);
  const allow = state.product && state.product.kind !== 'insole' ? 12 : 6;
  return { footL, L: footL + allow, W: footW + 4, eu: sizeFromLength(footL).eu };
}
// v9: generic foot for the designer (before the scan): chosen EU size or EU 41
function genericFoot() { const eu = +(state.design?.size || 41), L = lengthFromEU(eu); return { side: 'R', length: L, width: Math.round(L * .39), archType: 'normal', source: 'generic' }; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function mainFoot() { return state.feet[state.side] || Object.values(state.feet)[0]; }
function longestFoot() { return Object.values(state.feet).reduce((a, b) => (!a || b.length > a.length ? b : a), null); }

/* ---------------- scan screen (v10: real 3D scan upload, right then left; staff: manual measurements / sample feet) ---------------- */
const SRC_LABEL = { file: '3D scan', manual: 'manual measurements', sample: 'sample feet (test)', demo: 'sample feet (test)', generic: 'standard size' };
const testMode = () => localStorage.getItem('fxStaffTest') === '1';
function syncSideSeg() {
  $$('#scanSteps span').forEach(s => { const sd = s.dataset.side; s.classList.toggle('on', sd === state.side); s.classList.toggle('done', !!state.feet[sd]); });
  $('#uploadTxt').textContent = `Upload ${sideName(state.side).toLowerCase()} foot scan`;
  renderScanFeet();
}
function renderScanFeet() {
  const el = $('#scanFeet'); if (!el) return;
  el.innerHTML = ['R', 'L'].map(sd => { const f = state.feet[sd], cur = sd === state.side && !f;
    return `<div class="sf ${f ? 'done' : ''} ${cur ? 'cur' : ''}"><div class="sf-ic">${f ? '✓' : sd === 'R' ? '①' : '②'}</div><div><b>${sideName(sd)} foot</b><small>${f ? `${esc(SRC_LABEL[f.source] || f.source)}${f.file ? ' · ' + esc(f.file) : ''} · ${f.length} mm` : cur ? 'Upload this scan now' : 'Waiting'}</small></div></div>`; }).join('');
}
// after a foot is captured: right -> "now your left foot" -> both feet preview
function afterCapture(side) {
  const other = side === 'R' ? 'L' : 'R';
  if (!state.feet[other]) {
    if (!$('#s-scan').classList.contains('active')) show('s-scan');
    state.side = other; syncSideSeg(); window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`${sideName(side)} foot ✓ – now upload your ${sideName(other).toLowerCase()} foot`, 3200);
  } else { state.side = 'R'; toast('Both feet ready 🎉'); show('s-preview'); }
}
// staff test tool only (Settings → Test tools): plausible sample feet, clearly marked "sample" everywhere
function makeSampleFoot(side) {
  const other = state.feet[side === 'L' ? 'R' : 'L'];
  const r = rng(Date.now() ^ (side === 'L' ? 77 : 11));
  let archType;
  if (other && other.source === 'sample' && r() < 0.5) archType = other.archType; // feet can differ
  else { const x = r(); archType = x < 0.15 ? 'high' : x < 0.5 ? 'normal' : x < 0.8 ? 'low' : 'flat'; }
  const L = other ? other.length + Math.round(r() * 6 - 3) : Math.round(232 + r() * 50);
  const csiRange = { high: [5, 19], normal: [22, 44], low: [46, 59], flat: [61, 78] }[archType];
  const ahi = { high: .37, normal: .34, low: .315, flat: .29 }[archType] + (r() - .5) * .012;
  state.feet[side] = {
    side, source: 'sample', archType, length: L, width: Math.round(L * (0.385 + r() * 0.03)),
    csi: Math.round(csiRange[0] + r() * (csiRange[1] - csiRange[0])), ahi: +ahi.toFixed(3), peakForefootPressure: +(0.6 + r() * 0.4).toFixed(2)
  };
  delete state.archOverride[side]; delete state.uploaded[side]; delete state.rawScans[side];
}
function archFromCSI(csi) { return csi < 20 ? 'high' : csi <= 45 ? 'normal' : csi <= 60 ? 'low' : 'flat'; }
$('#sampleFeetBtn').onclick = () => { if (!state.staff || !testMode()) return; makeSampleFoot('R'); makeSampleFoot('L'); toast('🧪 Sample feet loaded (staff test – not a customer scan)', 3000); state.side = 'R'; show('s-preview'); };
// staff fallback: manual measurements (Brannock / tape) per foot
function manualFoot(side, L, W, archType) {
  const csi = { high: 12, normal: 33, low: 52, flat: 68 }[archType];
  state.feet[side] = { side, source: 'manual', archType, length: Math.round(L), width: Math.round(W), csi, ahi: { high: .37, normal: .34, low: .315, flat: .29 }[archType], peakForefootPressure: .8, enteredBy: staffName() || 'staff' };
  delete state.archOverride[side]; delete state.uploaded[side]; delete state.rawScans[side]; delete modelCache[side];
}
$('#manualBtn').onclick = () => {
  if (!state.staff) return;
  const row = sd => { const f = state.feet[sd]?.source === 'manual' ? state.feet[sd] : null; return `<div class="mm-foot"><b>${sideName(sd)} foot</b>
    <label class="field">Foot length (mm)<input type="number" id="mmL${sd}" min="120" max="340" step="1" inputmode="numeric" value="${f?.length || ''}" placeholder="e.g. 255"></label>
    <label class="field">Foot width at the ball (mm)<input type="number" id="mmW${sd}" min="50" max="140" step="1" inputmode="numeric" value="${f?.width || ''}" placeholder="e.g. 100"></label>
    <label class="field">Arch type<select id="mmA${sd}">${Object.entries(R.ARCH_TYPES).map(([k, v]) => `<option value="${k}" ${(f?.archType || 'normal') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label></div>`; };
  sheet(`<h3>📏 Manual measurements</h3><p class="tiny muted">Staff fallback when no 3D scan is possible. Measure standing, heel to longest toe, and the widest part of the ball of the foot. Orders are marked “manual measurements”.</p>${row('R')}${row('L')}<p class="tiny" id="mmMsg" style="color:#c0392b;min-height:1.2em"></p><button class="btn primary big" id="mmOk">Use these measurements</button>`);
  $('#mmOk').onclick = () => {
    const vals = ['R', 'L'].map(sd => ({ sd, L: +$('#mmL' + sd).value, W: +$('#mmW' + sd).value, a: $('#mmA' + sd).value }));
    const ok = v => v.L >= 120 && v.L <= 340 && v.W >= 50 && v.W <= 140 && v.W < v.L * .55;
    const bad = vals.find(v => (v.L || v.W) && !ok(v)); if (bad) { $('#mmMsg').textContent = `${sideName(bad.sd)} foot: length 120–340 mm, width 50–140 mm, please check.`; return; }
    const good = vals.filter(ok); if (!good.length) { $('#mmMsg').textContent = 'Enter at least one foot.'; return; }
    good.forEach(v => manualFoot(v.sd, v.L, v.W, v.a)); $('#sheet').classList.add('hidden');
    toast(`Manual measurements saved (${good.map(v => sideName(v.sd)).join(' + ')})`); state.side = 'R';
    if (state.feet.R && state.feet.L) show('s-preview'); else { state.side = state.feet.R ? 'L' : 'R'; syncSideSeg(); }
  };
};
// uploaded scans: auto-align (units, floor plane, heel/toe, left/right, trim ankle) -> 2 mm plantar map
function objToGeo(obj) {
  if (obj.isBufferGeometry) { const g = obj.index ? obj.toNonIndexed() : obj; if (!g.attributes.position?.count) throw new Error('No mesh found in the file'); const h = new THREE.BufferGeometry(); h.setAttribute('position', g.attributes.position); return h; } // STL / PLY (PLY may be indexed, with colours)
  const parts = []; obj.updateMatrixWorld(true);
  obj.traverse(m => { if (m.isMesh) { let g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); g = g.index ? g.toNonIndexed() : g; const h = new THREE.BufferGeometry(); h.setAttribute('position', g.attributes.position); parts.push(h); } });
  if (!parts.length) throw new Error('No mesh found in the file');
  const n = parts.reduce((s, g) => s + g.attributes.position.count, 0), arr = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { arr.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return out;
}
function heightColored(geo) {
  const g = geo.clone(), P = g.attributes.position, col = new Float32Array(P.count * 3);
  const skin = new THREE.Color('#e3b69c');
  for (let i = 0; i < P.count; i++) { const y = P.getY(i), c = y < 16 ? heatColor(Math.max(0, 1 - y / 14)).lerp(skin, THREE.MathUtils.smoothstep(y, 10, 16)) : skin; col.set([c.r, c.g, c.b], 3 * i); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true }));
}
function applyAligned(res, name, raw) {
  const md = res.model, side = md.side, archType = archFromCSI(md.csi);
  state.uploaded[side] = heightColored(res.geo);
  state.rawScans[side] = { geo: raw, name, info: res.info };
  state.feet[side] = { side, source: 'file', file: name, archType, length: Math.round(md.L), width: Math.round(md.W), heelWidth: Math.round(md.heelW), csi: md.csi, ahi: { high: .37, normal: .34, low: .315, flat: .29 }[archType], peakForefootPressure: 0.8, triangles: res.info.triangles,
    units: res.info.units, archHeightMm: md.archH, map: encodeGrid(md.grid), mapId: Date.now() + Math.random(), align: { ...res.info } };
  delete state.archOverride[side]; delete modelCache[side];
  return side;
}
function realign(side, nudge) {
  const r = state.rawScans[side]; if (!r) return side;
  const res = alignScan(r.geo, r.name, nudge);
  const ns = res.model.side;
  if (ns !== side) { delete state.feet[side]; delete state.uploaded[side]; delete state.rawScans[side]; state.nudge[ns] = nudge; delete state.nudge[side]; }
  return applyAligned(res, r.name, r.geo);
}
$('#fileInput').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  try {
    toast('Loading ' + f.name + '…');
    let obj;
    if (/\.stl$/i.test(f.name)) obj = new STLLoader().parse(await f.arrayBuffer());
    else if (/\.obj$/i.test(f.name)) obj = new OBJLoader().parse(await f.text());
    else if (/\.ply$/i.test(f.name)) obj = new PLYLoader().parse(await f.arrayBuffer());
    else throw new Error('Please choose an STL, OBJ or PLY file');
    const raw = objToGeo(obj);
    const res = alignScan(raw, f.name);
    const side = applyAligned(res, f.name, raw);
    state.nudge[side] = {};
    toast(`${f.name}: ${sideName(side)} foot detected · ${res.info.units} → mm · ${Math.round(res.model.L)} mm long`, 3600);
    if (state.staff) { state.alignSide = side; state.alignThen = true; show('s-align'); }
    else afterCapture(side);
  } catch (err) { console.warn(err); toast('Could not read this scan: ' + err.message + '. Please try another file or ask our staff.', 5000); }
};

/* ---------------- preview: both feet side by side ---------------- */
function footObject(side) {
  const f = state.feet[side]; if (!f) return null;
  const up = state.uploaded[side];
  let o;
  if (up) { const g = up.geometry.clone(), heat = g.attributes.color.array.slice(), skin = new Float32Array(heat.length); const c = new THREE.Color('#e3b69c'); for (let i = 0; i < skin.length; i += 3) skin.set([c.r, c.g, c.b], i); o = wrapFoot(g, skin, heat); }
  else o = buildFoot({ L: f.length, W: f.width, archType: archOf(side), side, peak: f.peakForefootPressure });
  o.userData.look?.(state.look);
  return o;
}
function renderFoot() {
  footViewer ||= (() => { const v = new Viewer($('#footViewer'), { free: true }); $('#footViewer').addEventListener('viewchange', () => $$('#pvViews button').forEach(b => b.classList.remove('on'))); return v; })();
  const avail = ['L', 'R'].filter(s => state.feet[s]);
  if (state.previewSide !== 'both' && !state.feet[state.previewSide]) state.previewSide = 'both';
  const sides = state.previewSide === 'both' ? avail : [state.previewSide];
  const g = new THREE.Group(), labels = [];
  sides.forEach(s => { const o = footObject(s), f = state.feet[s]; if (sides.length > 1) o.position.x = (s === 'R' ? 1 : -1) * 68; /* v8.2: anatomical layout – right foot on +x (screen right when seen from behind/above, as the person sees their own feet) */ g.add(o); labels.push({ text: sideName(s), pos: new THREE.Vector3(o.position.x, f.length * 0.5, 0) }); });
  footViewer.set(g, false);
  footViewer.setLabels(labels);
  footViewer.medialX = sides.length === 1 && sides[0] === 'L' ? 1 : -1;
  const srcs = [...new Set(sides.map(s => state.feet[s].source))], allFile = srcs.every(x => x === 'file');
  $('#previewTitle').textContent = allFile ? 'Your 3D feet' : 'Your feet';
  $('#previewSource').textContent = (sides.length > 1 ? 'Both feet' : sideName(sides[0]) + ' foot') + ' · ' + (allFile ? 'from your 3D scan' : srcs.includes('manual') ? 'illustration from measurements' : srcs.includes('file') ? 'scan + illustration' : 'sample feet – staff test');
  $$('#pvSide button').forEach(b => { b.classList.toggle('active', b.dataset.v === state.previewSide); b.disabled = b.dataset.v !== 'both' && !state.feet[b.dataset.v]; });
  $$('#pvLook button').forEach(b => b.classList.toggle('on', !!state.look[b.dataset.k]));
  $$('#pvViews button').forEach(b => b.classList.toggle('on', b.dataset.view === 'spin'));
  $('#pvLegend').classList.toggle('hidden', !state.look.heat);
}
$$('#pvSide button').forEach(b => b.onclick = () => { state.previewSide = b.dataset.v; renderFoot(); });
$$('#pvViews button').forEach(b => b.onclick = () => {
  if (!footViewer) return;
  $$('#pvViews button').forEach(x => x.classList.toggle('on', x === b));
  if (b.dataset.view === 'spin') { footViewer.view('iso', true, footViewer.medialX); setTimeout(() => (footViewer.autoSpin = true), 560); }
  else footViewer.view(b.dataset.view, true, footViewer.medialX);
});
$$('#pvLook button').forEach(b => b.onclick = () => {
  state.look[b.dataset.k] = !state.look[b.dataset.k]; b.classList.toggle('on', state.look[b.dataset.k]);
  footViewer?.obj?.traverse(o => o.userData.look && o.userData.look(state.look));
  $('#pvLegend').classList.toggle('hidden', !state.look.heat);
});
function feetStatus() {
  $('#feetStatus').innerHTML = ['L', 'R'].map(s => { const f = state.feet[s]; return `<span class="tag ${f ? '' : 'warn'}">${sideName(s)}: ${f ? (state.staff ? R.ARCH_TYPES[archOf(s)].short : R.ARCH_FRIENDLY[archOf(s)]) + ' · EU ' + sizeFromLength(f.length).eu : 'not scanned'}</span>`; }).join('');
}
$('#rescanBtn').onclick = () => { state.feet = {}; state.uploaded = {}; state.side = 'R'; show('s-scan'); };

/* ---------------- analysis ---------------- */
function renderAnalysis() {
  const sides = ['L', 'R'].filter(s => state.feet[s]);
  if (!state.feet[state.side]) state.side = sides[0];
  $('#analysisSideSeg').innerHTML = sides.map(s => `<button class="seg-btn ${s === state.side ? 'active' : ''}" data-s="${s}">${sideName(s)} foot</button>`).join('');
  $('#analysisSideSeg').classList.toggle('hidden', sides.length < 2);
  $$('#analysisSideSeg .seg-btn').forEach(b => b.onclick = () => { state.side = b.dataset.s; renderAnalysis(); });
  $('#compareRow').innerHTML = sides.length > 1 ? ['L', 'R'].map(s => `<div class="cf"><span>${sideName(s)} foot</span><b>${state.staff ? R.ARCH_TYPES[archOf(s)].short : R.ARCH_FRIENDLY[archOf(s)]}</b><span>${state.feet[s].length} mm · EU ${sizeFromLength(state.feet[s].length).eu}</span></div>`).join('') : '';
  const f = state.feet[state.side], a = archOf(state.side), sz = sizeFromLength(f.length);
  $('#mLen').textContent = f.length + ' mm'; $('#mWid').textContent = f.width + ' mm';
  $('#mAhi').textContent = state.staff ? f.ahi.toFixed(2) : R.ARCH_FRIENDLY[a].replace(' arch', '').replace(' feet', ''); $('#mSize').textContent = 'EU ' + sz.eu;
  $('#metricSource').textContent = f.source === 'file'
    ? `Measured from ${f.file}. Arch estimated from footprint contact (Chippaux-Smirak index ${f.csi}%). Arch height index is an estimate.`
    : f.source === 'manual' ? `Manual measurements entered by ${esc(f.enteredBy || 'staff')} (no 3D scan). Arch type chosen by staff; the 3D foot is an illustration. Size ≈ EU ${sz.eu} / US M ${sz.usM} / US W ${sz.usW}.`
    : `Sample feet (staff test – not a customer scan). Contact index (CSI) ${f.csi}%. Size ≈ EU ${sz.eu}.`;
  drawFootprint($('#footprintCanvas'), { archType: a, peak: f.peakForefootPressure, side: state.side, W: 100 });
  const at = R.ARCH_TYPES[a];
  $('#archTitle').innerHTML = (state.staff ? at.label : R.ARCH_FRIENDLY[a]) + (state.archOverride[state.side] ? ' <small class="tag">staff override</small>' : '');
  $('#archExplain').textContent = state.staff ? at.explain : R.ARCH_FRIENDLY_TEXT[a];
  $$('#archScale span').forEach(s => s.classList.toggle('on', s.dataset.a === a));
  $('#archOverride').value = a;
  const sug = R.suggestFromScan({ ...f, archType: a });
  $('#scanSuggest').innerHTML = sug.length ? `<div class="alert info"><b>${state.staff ? 'Scan suggests:' : 'We noticed:'}</b> ${sug.map(id => state.staff ? R.CONDITIONS.find(c => c.id === id).name : R.FRIENDLY[id]).join(', ')}. ${state.staff ? 'Pre-selected in the checklist.' : "We'll take care of this in your design."}</div>` : '';
}
$('#archOverride').onchange = e => { state.archOverride[state.side] = e.target.value; recompute(); renderAnalysis(); };

/* ---------------- health ---------------- */
const BASE_ANSWERS = { diabetes: 'no', heelPain: 'no', jointPain: 'no', standing: '0-4', activity: 'moderate', weight: '60-90' };
// conditions = scan suggestions + questionnaire answers + staff edits
function recompute() {
  const { ids, answers } = R.conditionsFromQA(state.qa);
  const src = {};
  Object.keys(state.feet).forEach(s => R.suggestFromScan({ ...state.feet[s], archType: archOf(s) }).forEach(id => (src[id] = 'scan')));
  ids.forEach(id => (src[id] = 'answers'));
  state.staffAdds.forEach(id => (src[id] = src[id] || 'staff'));
  state.staffRemoves.forEach(id => delete src[id]);
  state.sources = src; state.conditions = new Set(Object.keys(src));
  state.answers = { ...BASE_ANSWERS, ...answers, lldMm: state.answers.lldMm, lldSide: state.answers.lldSide };
  if (state.conditions.has('diabetic')) state.answers.diabetes = 'yes';
}
/* ---------------- one-page questionnaire (chips) ---------------- */
function renderQuestionnaire() {
  $('#qForm').innerHTML = R.QUESTIONS.map(q => {
    const cur = state.qa[q.id], sel = v => (Array.isArray(cur) ? cur.includes(v) : cur === v);
    return `<div class="q-sec" data-q="${q.id}"><h4><span>${q.icon}</span>${q.title}${q.help ? ` <small>${q.help}</small>` : ''}</h4>
      <div class="q-chips">${q.options.map(o => `<button class="q-chip ${sel(o.v) ? 'on' : ''}" data-v="${o.v}"><span class="ic">${o.icon || ''}</span>${o.label}</button>`).join('')}</div></div>`;
  }).join('');
  $$('#qForm .q-sec').forEach(sec => sec.querySelectorAll('.q-chip').forEach(b => b.onclick = () => {
    const q = R.QUESTIONS.find(x => x.id === sec.dataset.q), v = b.dataset.v, cur = state.qa[q.id];
    if (q.type === 'single') state.qa[q.id] = cur === v ? undefined : v;
    else {
      const opt = q.options.find(o => o.v === v); let arr = Array.isArray(cur) ? [...cur] : [];
      if (opt.none) arr = arr.includes(v) ? [] : [v];
      else { arr = arr.filter(x => !q.options.find(o => o.v === x).none); arr = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]; }
      state.qa[q.id] = arr;
    }
    if (q.id === 'diabetes' && v === 'yes' && state.qa.diabetes === 'yes') toast('Thanks – we will make it extra soft and gentle 💚');
    sec.querySelectorAll('.q-chip').forEach(x => { const c2 = state.qa[q.id]; x.classList.toggle('on', Array.isArray(c2) ? c2.includes(x.dataset.v) : c2 === x.dataset.v); });
    recompute(); renderConditions();
  }));
}
$('#seeResultsBtn').onclick = () => { recompute(); toast('Great, thank you! 🙌'); if (state.design) { applyDesign(); show('s-result'); } else show('s-products'); };
function prevQuestion() { return false; }
function modsText(c) {
  const m = c.mods, out = [];
  const map = { heelCupDepth: v => `Heel cup ${v} mm`, heelCushion: () => 'Soft heel cushion', heelCutout: () => 'Heel spur pocket', archHeight: v => `Arch support ~${v} mm`, heelLift: v => v === 'llD' ? 'Heel / full lift (up to 6 mm in insole)' : `Heel lift ${v} mm`, metPad: v => v === 'neuroma' ? 'Met pad behind 3rd–4th met heads' : 'Metatarsal dome', forefootExtraWidth: v => `Forefoot +${v} mm wider`, firstMTPRelief: () => 'Big-toe joint relief', mortonExtension: () => "Morton's extension", rocker: () => 'Rocker shape', sesamoidCutout: () => "Dancer's pad cutout", toeCrest: () => 'Toe crest', topCover: v => `Soft top cover ${v} mm`, medialPost: v => `Medial post ${v}°`, medialHeelSkive: v => `Medial heel skive ${v}°`, lateralWedge: v => `Lateral wedge ${v}°`, lateralSupport: () => 'Lateral support', shockAbsorb: () => 'Shock absorption', fullContact: () => 'Full contact', lateralFlare: () => 'Lateral heel flare', lateralFlange: () => 'Lateral flange', noHardEdges: () => 'No seams / hard edges', offloadPockets: () => 'Offloading pockets', referClinician: () => 'Clinician check', shore: v => ({ soft: 'Softer TPU', medium: 'Medium 90A', firm: 'Firmer TPU', forceSoft: 'Soft TPU 85A (always)' })[v] };
  for (const [k, v] of Object.entries(m)) if (map[k]) out.push(map[k](v));
  return out;
}
function renderConditions() {
  const groups = {};
  R.CONDITIONS.forEach(c => (groups[c.group] ||= []).push(c));
  const html = Object.entries(groups).map(([g, list]) => `<div class="cond-group"><h4>${g}</h4>${list.map(c => {
    const on = state.conditions.has(c.id), src = state.sources[c.id];
    const badge = on && src === 'scan' ? '<span class="badge">from scan</span>' : on && src === 'answers' ? '<span class="badge">from answers</span>' : on && src === 'staff' ? '<span class="badge">staff</span>' : '';
    return `<div class="cond ${on ? 'on' : ''}" data-id="${c.id}"><span class="box">${on ? '✓' : ''}</span><span class="txt">${R.FRIENDLY[c.id] || c.name}${badge}<small>${c.name} · ${c.signs}</small></span><button class="info-btn" data-info="${c.id}" aria-label="Info">i</button></div>`;
  }).join('')}</div>`).join('');
  $('#condList').innerHTML = html; $('#staffCondList').innerHTML = html;
  $$('#condList .cond, #staffCondList .cond').forEach(el => el.onclick = e => {
    if (e.target.closest('.info-btn')) return;
    const id = el.dataset.id;
    if (state.conditions.has(id)) { state.staffAdds.delete(id); state.staffRemoves.add(id); } else { state.staffRemoves.delete(id); state.staffAdds.add(id); }
    recompute(); renderConditions(); if ($('#s-staff').classList.contains('active')) renderStaff();
  });
  $$('#condList .info-btn, #staffCondList .info-btn').forEach(b => b.onclick = () => {
    const c = R.CONDITIONS.find(x => x.id === b.dataset.info);
    sheet(`<h3>${c.name}</h3><p class="muted"><b>Signs:</b> ${c.signs}</p><p>${c.explain}</p><b>What we change in the insole:</b><ul>${modsText(c).map(t => `<li>${t}</li>`).join('')}</ul><p class="disclaimer small">Comfort product – not a medical diagnosis.</p>`);
  });
  $('#lldBox').classList.toggle('hidden', !state.conditions.has('leg_length'));
}
$('#lldMm').oninput = e => { state.answers.lldMm = +e.target.value; $('#lldVal').textContent = e.target.value; };
$('#lldSide').onchange = e => { state.answers.lldSide = e.target.value; };

/* ---------------- products ---------------- */
// v7: rule engine picks the best model for this customer (diabetes -> Diabetic Care, 8+ h standing -> Work, sporty -> Sport, small foot -> Kids)
function recommendNow() { const f = longestFoot(); return R.recommendProduct([...state.conditions], state.answers, f ? f.length : null); }
function renderProducts() {
  const f = longestFoot(), sz = f ? sizeFromLength(f.length) : null, rec = recommendNow();
  const list = [...R.PRODUCTS.filter(p => p.id === rec.id), ...R.PRODUCTS.filter(p => p.id !== rec.id && p.line === 'v7'), ...R.PRODUCTS.filter(p => p.id !== rec.id && p.line !== 'v7')];
  $('#productList').innerHTML = list.map(p => `<div class="product ${state.product?.id === p.id ? 'on' : ''} ${p.id === rec.id ? 'rec' : ''}" data-id="${p.id}">
    <img src="${p.image}" alt="${p.name}" loading="lazy" class="${p.illustration ? 'p-illus' : ''}">${p.detail ? `<button type="button" class="p-detail" data-swap="${p.detail.image}" data-alt="${p.image}" title="${esc(p.detail.label)}"><img src="${p.detail.image}" alt="${esc(p.detail.label)}" loading="lazy"><span>${esc(p.detail.label)}</span></button>` : ''}${p.illustration ? `<div class="illus-cap">${esc(p.illusCap || 'Illustration – your insole is custom-made from your scan')}</div>` : ''}<div class="p-body">${p.id === rec.id ? `<span class="rec-badge">⭐ Recommended for you</span>` : ''}<b>${p.name}</b>${p.tagline ? `<small class="p-tag">${p.tagline}</small>` : ''}<p>${p.desc}</p>${p.id === rec.id ? `<p class="tiny rec-why">${rec.why}</p>` : ''}
    <div class="p-meta"><div class="swatches">${p.colors.map(c => `<span class="sw" style="background:${c}"></span>`).join('')}</div><span class="tag">${sz ? 'Size EU ' + sz.eu + ' (from scan)' : ''}</span></div></div></div>`).join('');
  $$('#productList .p-detail').forEach(b => b.onclick = e => { e.stopPropagation(); const card = b.closest('.product'), main = card.querySelector('img'), thumb = b.querySelector('img'), a = b.dataset.swap, c = b.dataset.alt; main.src = a; thumb.src = c; b.dataset.swap = c; b.dataset.alt = a; });
  $$('#productList .product').forEach(el => el.onclick = () => {
    const p = R.PRODUCTS.find(x => x.id === el.dataset.id);
    if (state.product?.id !== p.id) { state.product = p; state.color = p.colors[0]; state.strapColor = p.strapColors?.[0]; }
    renderProducts(); $('#toResultBtn').disabled = false;
  });
  $('#toResultBtn').disabled = !state.product;
}
$('#toResultBtn').onclick = () => show('s-result');

/* ---------------- result ---------------- */
const PARAM_ROWS = [
  ['Arch height', p => p.archHeight + ' mm'], ['Heel cup depth', p => p.heelCupDepth + ' mm'], ['Medial post', p => p.medialPost ? p.medialPost + '°' : 'none'],
  ['Medial heel skive', p => p.medialHeelSkive ? p.medialHeelSkive + '°' : 'none'], ['Lateral wedge', p => p.lateralWedge ? p.lateralWedge + '°' : 'none'],
  ['Heel lift', p => p.heelLift ? p.heelLift + ' mm' : 'none'], ['Shore hardness', p => 'TPU ' + p.shore + (p.dualDensity ? ' + soft top' : '')], ['Infill', p => p.infill],
  ['Top cover', p => p.topCover + ' mm soft'], ['Metatarsal pad', p => p.metPad ? (p.metPad === 'neuroma' ? '3rd–4th (neuroma)' : 'central dome') : 'none'],
  ['Forefoot width', p => p.forefootExtraWidth ? '+' + p.forefootExtraWidth + ' mm' : 'standard'],
  ['Special features', p => [p.fullContact && 'full contact', p.heelCushion && 'heel cushion', p.heelCutout && 'spur pocket', p.sesamoidCutout && "dancer's pad", p.firstMTPRelief && '1st MTP relief', p.mortonExtension && "Morton's ext.", p.toeCrest && 'toe crest', p.rocker && 'rocker', p.lateralFlange && 'lateral flange', p.lateralFlare && 'lateral flare', p.offloadPockets && 'offload pockets', p.noHardEdges && 'rounded edges', p.shockAbsorb && 'shock absorb'].filter(Boolean).join(', ') || '–']
];
const ZONE_FRIENDLY = { heel: 'Heel cup', heelCenter: 'Soft heel spot', heelLift: 'Heel lift', medialHeel: 'Inner heel support', medialArch: 'Arch support', lateralArch: 'Outer support', lateralEdge: 'Ankle guard', metPad: 'Ball-of-foot pad', neuromaPad: 'Toe-nerve pad', metHeads: 'Ball of foot', firstMTP: 'Big-toe space', sesamoid: 'Big-toe relief', hallux: 'Big-toe plate', toeCrest: 'Toe support', forefoot: 'Roomy toes', rocker: 'Rolling toe', fullLength: 'All-over cushion' };
function renderFeetSummary(spec) {
  const pills = [R.ARCH_FRIENDLY[spec.archType], ...spec.conditions.filter(id => !['standing_worker', 'athlete'].includes(id) || true).map(id => R.FRIENDLY[id])];
  const uniq = [...new Set(pills)];
  const ben = R.benefits(spec.params);
  $('#feetSummary').innerHTML = `<div class="fs-label">Your feet</div><div class="fs-pills">${uniq.map((p, i) => `${i ? '<span class="fs-plus">+</span>' : ''}<span class="fs-pill">${p}</span>`).join('')}</div>
    <div class="fs-label">We'll add</div><ul class="benefits">${ben.map(([ic, t], i) => `<li style="animation-delay:${i * 70}ms"><span>${ic}</span>${t}</li>`).join('')}</ul>
    ${spec.params.referClinician ? '<div class="care-note">💚 Because of diabetes we keep everything extra soft. Please also show your feet to a doctor or podiatrist.</div>' : ''}`;
}
function currentSpec(side = state.side) {
  const ans = { ...state.answers };
  if (state.conditions.has('leg_length') && ans.lldSide && ans.lldSide[0].toUpperCase() !== side) ans.lldMm = 0; // lift only on the shorter leg
  const res = R.combine(archOf(side), [...state.conditions], ans);
  const pr = state.product;
  if (pr?.model) { // v7 insole line: the chosen model sets its own clinical params (thickness profile, cup, edges, pads, material)
    const keep = { metPad: res.params.metPad };
    Object.assign(res.params, pr.params || {});
    if (keep.metPad && !pr.params?.metPad) res.params.metPad = keep.metPad; // prescribed met pad is kept
    if (pr.model.archFill) res.params.archFill = pr.model.archFill;
    const fl = state.feet[side]?.length;
    if (pr.model.scaleWithSize && fl) res.params.heelCupDepth = Math.round(res.params.heelCupDepth * Math.min(1, Math.max(.75, fl / 240)));
    res.params.model = pr.id;
    if ((res.params.referClinician || state.conditions.has('diabetic')) && pr.id !== 'diabetic') res.conflicts.push(`Diabetes: "${pr.name}" uses TPU ${res.params.shore} – the Fixifoot Diabetic Care model (extra soft, no hard edges, offload pockets) is recommended.`);
    res.notes.push(`Model ${pr.name}: ${pr.model.summary}. Smooth toe area (v6.1), no ridges between the toes.`);
  }
  if (state.archFill != null) res.params.archFill = state.archFill;
  const md = scanModel(side);
  if (md) { res.totalContact = true; res.scanArchH = md.archH; res.notes.unshift(`Total contact: top surface = scanned plantar surface (2 mm grid, heel → toe sulcus), arch filled ${res.params.archFill ?? 100}%; clinical modifications added on top.`); }
  return res;
}
/* ---------------- scan-accurate model (plantar map) ---------------- */
const modelCache = {};
function footModel(side) {
  const f = state.feet[side]; if (!f) return null;
  const key = [f.source, f.length, f.width, archOf(side), f.peakForefootPressure, f.mapId || ''].join('|');
  if (modelCache[side]?.key === key) return modelCache[side].md;
  let md = null;
  try {
    if (f.map) md = deriveModel(decodeGrid(f.map));
    else { const o = buildFoot({ L: f.length, W: f.width, archType: archOf(side), side, peak: f.peakForefootPressure }); let mesh = null; o.traverse(m => { if (!mesh && m.isMesh) mesh = m; }); md = deriveModel(rasterizePlantar(mesh.geometry)); }
  } catch (e) { console.warn('foot model', e); }
  modelCache[side] = { key, md }; return md;
}
const scanModel = side => (state.totalContact ? footModel(side) : null);
function lastLenFor(kind) { if (state.sizeMode === 'scan') return null; const a = ALLOW[kind] || ALLOW.insole; return lengthFromEU(+state.sizeMode) + a.heel + a.toe; }
const tplKind = p => p.kind === 'insole' && !p.model; // v7 line models are always built from the scan / parametric surface (no template)
const thickFor = p => (p.id === 'perforated' ? 2.2 : p.id === 'fullcontact' ? 3.6 : undefined);
// one place that builds the product for display (zones) or for printing / fit check
const openingMode = p => p?.id === 'perforated' || p?.model?.openings === 'holes' ? 'holes' : p?.id === 'slide' ? 'lattice' : null;
function openingsFor(p) { const m = openingMode(p); if (!(m && state.openings.on)) return null;
  const o = { mode: m, density: state.openings.density, ...(m === 'holes' ? { d: state.openings.d || 3.5 } : {}) };
  if (m === 'lattice' && designText()) { const base = defaultAllow('lattice'); o.allow = (u, sn) => base(u, sn) && !(u > .06 && u < .29 && Math.abs(sn) < .82); o.labelPatch = true; } // v9: solid patch under the engraved initials
  return o; }
// v8: 2-material split of an insole-line model (two scan-fitted bodies sharing one interface)
const dualCache = {};
function dualFor(side, spec = currentSpec(side)) {
  const p = ensureProduct(); if (!p.dual) return null;
  const md = scanModel(side), model = p.id === 'diabetic' ? { ...p.model, recesses: [] } : p.model; // diabetic: the pockets are filled by the soft inserts
  const txt = designText(), key = JSON.stringify([p.id, side, state.sizeMode, state.totalContact, spec.params, state.openings, state.feet[side]?.mapId, state.feet[side]?.length, md?.L, state.design?.size, txt, txt && engraverReady()]);
  if (dualCache[side]?.key === key) return withDesignColors(dualCache[side].v);
  let rows, lenKey, ballU, L;
  if (md) { const s = buildContactSole(md, { params: { ...spec.params, _model: model }, kind: 'insole', zones: [], showZones: false, color: '#ffffff', lastLen: lastLenFor('insole') }); rows = s.userData.rows; lenKey = 'z'; ballU = md.ballU; L = md.L; s.geometry.dispose(); }
  else { const d = productDims(side); ({ rows, lenKey } = printableRows(p, { L: d.L, W: d.W, params: spec.params, side, model })); ballU = .72; L = d.footL; }
  const pos = { met: { u: ballU + .005, sn: 0, ru: .045 * L, rsn: .66 }, hallux: { u: Math.min(ballU + .125, .93), sn: .5, ru: .045 * L, rsn: .3 }, arch: { u: .41, sn: .56, ru: .14 * L, rsn: .2 }, pad: { u: ballU - 15 / L, sn: .05, ru: 12, rsn: .36 } };
  let label = null; // v9: keep the base/top solid (no lattice cells or holes) under the engraved initials, so the letter floor stays >= 1.2 mm
  if (txt && engraverReady() && (R.DESIGN[p.id]?.text || 'top') === 'top') { const m = measureText(txt, TEXT_RULES.capMm), hw = Math.max(22, .12 * L), along = m.w > hw * .95;
    label = { u: R.DESIGN[p.id]?.textU ?? .17, du: ((along ? Math.min(m.w, .25 * L) : m.h) / 2 + 7) / L, sn: Math.min(.9, ((along ? m.h : m.w) / 2 + 7) / hw) }; }
  const v = buildTwoMaterial(rows, lenKey, p.dual, { ballU, L, pos, label, holes: openingsFor(p), allowHoles: defaultAllow('holes', spec.params, ballU) });
  if (txt) { // v9: initials engraved as real geometry into both bodies (2-colour inlay on layered models)
    const where = R.DESIGN[p.id]?.text || 'top', mode = p.dual.type === 'layer' && where === 'top' ? 'layer' : 'cut';
    if (!engraverReady()) v.engraving = { text: txt, pending: true };
    else try { const plan = planText(v.bodies.map(b => b.geometry), txt, where, R.DESIGN[p.id]?.textU); if (!plan) throw new Error('text too long for the heel at the minimum letter height');
      const r = engraveBodies(v.bodies.map(b => b.geometry), plan, mode); v.bodies.forEach((b, i) => { b.geometry.dispose(); b.geometry = r.geos[i]; }); v.engraving = r.info;
      v.stats.minThicknessMm = Object.fromEntries(Object.entries(v.stats.minThicknessMm)); v.stats.engraving = r.info;
    } catch (e) { console.warn('engrave', e); v.engraving = { text: txt, error: e.message }; }
  }
  dualCache[side] = { key, v }; return withDesignColors(v);
}
// v9 design helpers
const PAL = id => R.PALETTE.find(c => c.id === id) || R.PALETTE[0];
const designText = () => cleanText(state.design?.text || '').trim();
function designParts(p = ensureProduct()) { const d = R.DESIGN[p.id] || R.DESIGN.everyday, c = state.design?.colors || { base: d.def[0], top: d.def[1] }; return [{ part: d.parts[0], extruder: 1, ...PAL(c.base) }, { part: d.parts[1], extruder: 2, ...PAL(c.top) }]; }
function withDesignColors(v) { if (!state.design || !v) return v; const dp = designParts(); return { ...v, bodies: v.bodies.map((b, i) => ({ ...b, color: dp[i].hex, colorName: dp[i].name })) }; }
const PRICE_KEY = 'fxPrices_v1';
const localPrices = () => { try { return JSON.parse(localStorage.getItem(PRICE_KEY)) || {}; } catch { return {}; } };
function priceOf(id) { const loc = localPrices(), cfg = window.FIXI_PRICES || {}; const v = loc[id] ?? cfg[id] ?? cfg.default ?? R.DEFAULT_PRICE; return Math.max(0, Math.round(+v || R.DEFAULT_PRICE)); }
function applyDesign() { const ds = state.design; if (!ds) return; const p = R.PRODUCTS.find(x => x.id === ds.productId); if (p && state.product?.id !== p.id) state.product = p; const dp = designParts(); state.color = dp[0].hex; state.strapColor = dp[1].hex; if (ds.size) state.sizeMode = String(ds.size); }
function startDesign(id) { const d = R.DESIGN[id]; const keep = state.design; state.design = { productId: id, colors: { base: d.def[0], top: d.def[1] }, text: keep?.text || '', size: keep?.size || '' }; applyDesign(); }
// engraved single solid (one-piece STL / sandal sole): Y-up geometry in, engraved geometry out (or the input when no text)
function engraveSingle(geo, p) {
  const txt = designText(); if (!txt) return { geo, info: null };
  if (!engraverReady()) return { geo, info: { text: txt, error: 'engraver still loading – try again in a second' } };
  try { const where = R.DESIGN[p.id]?.text || 'top', plan = planText([geo], txt, where, R.DESIGN[p.id]?.textU); if (!plan) throw new Error('text too long for the heel');
    const r = engraveBodies([geo], plan, 'cut'); return { geo: r.geos[0], info: r.info }; } catch (e) { console.warn('engrave', e); return { geo, info: { text: txt, error: e.message } }; }
}
function dualPrint(side) { const p = ensureProduct(), dv = dualFor(side); return dv ? { p, dv, bodies: bodiesToPrint(dv.bodies) } : null; }
function build3mfFor(side, id) {
  const r = dualPrint(side); if (!r) return null; const { p, dv, bodies } = r;
  const meta = { title: `${p.name} – ${sideName(side)} foot (${id})`, description: `${p.dual.look}. Two bodies assembled in place; extruder 1 = ${bodies[0].colorName} ${bodies[0].material}, extruder 2 = ${bodies[1].colorName} ${bodies[1].material}. Scan-fitted (Fixifoot).`,
    print: { model: p.name, orderId: id, side: sideName(side), ...(state.design ? { design: designSummary() } : {}), ...(dv.engraving ? { engraving: dv.engraving } : {}), ...p.print, base: `Extruder 1 – ${bodies[0].colorName} ${bodies[0].material} (${bodies[0].name})`, top: `Extruder 2 – ${bodies[1].colorName} ${bodies[1].material} (${bodies[1].name})`, singleMaterialProfile: { base: p.print?.base, top: p.print?.top }, dualMaterial: { look: p.dual.look, bodies: bodies.map(b => ({ name: b.name, material: b.material, color: b.color, colorName: b.colorName, extruder: b.extruder, infill: b.infill, volumeCm3: +(b.volumeMm3 / 1000).toFixed(1) })), interface: 'shared surface – no gap / overlap', stats: dv.stats } } };
  return { name: `${id}-${p.id}-2material-${sideName(side).toLowerCase()}.3mf`, data: build3MF(bodies, meta), bodies, stats: dv.stats };
}
function bodyStls(side, id) { const r = dualPrint(side); if (!r) return []; return r.bodies.map(b => ({ name: `${id}-${r.p.id}-${b.id}-${b.colorName.toLowerCase().replace(/[^a-z]+/g, '-')}-ext${b.extruder}-${sideName(side).toLowerCase()}.stl`, data: new STLExporter().parse(new THREE.Mesh(b.geometry), { binary: true }) })); }
const creasedCache = new WeakMap();
function creased(geo) { let c = creasedCache.get(geo); if (!c) { c = toCreasedNormals(geo, Math.PI / 5); creasedCache.set(geo, c); } return c.clone(); }
function productObject(side, spec, { display = true, zonesOn = state.showZones, openings = display } = {}) {
  const p = ensureProduct(), md = scanModel(side), useTpl = state.base && tplKind(p) && templateCache[state.base];
  if (display && p.dual && state.twoMat) { const dv = dualFor(side, spec); if (dv) { const g = new THREE.Group(); dv.bodies.forEach(b => { const m = new THREE.Mesh(dv.engraving && !dv.engraving.error && !dv.engraving.pending ? creased(b.geometry) : b.geometry.clone(), new THREE.MeshStandardMaterial({ color: b.color, roughness: .5, metalness: 0, side: THREE.DoubleSide })); m.name = b.id; g.add(m); }); g.userData.dual = dv.stats; return g; } }
  const op = openings ? openingsFor(p) : null;
  const integ = p.kind === 'insole' || state.integrate;
  const z = { zones: display ? spec.zones : [], showZones: display && zonesOn, highlight: display ? state.highlight : null };
  if (useTpl) {
    let g;
    if (md) g = morphTemplate(templateCache[state.base], md, { params: spec.params, full: TEMPLATES[state.base].full, color: state.color, lastLen: lastLenFor('insole'), ...z });
    else { g = templateGeo(side, spec, display); g.rotateX(-Math.PI / 2); }
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, side: THREE.DoubleSide })); m.userData.morphed = !!md; return m;
  }
  if (md && integ) {
    const lastLen = lastLenFor(p.kind);
    if (!display) { const s = buildContactSole(md, { params: { ...spec.params, _thick: thickFor(p), ...(p.model ? { _model: p.model } : {}) }, kind: p.kind, zones: [], showZones: false, color: state.color, lastLen, openings: op }); return s; }
    return engraveDisplay(buildProduct(p, { L: 0, W: 0, params: spec.params, side, ...z, color: state.color, strapColor: state.strapColor, upperColor: state.strapColor, integrate: true, openings: op, soleFn: o => buildContactSole(md, { ...o, lastLen }) }), p);
  }
  const d = productDims(side);
  if (!display) return buildPrintableSole(p, { L: d.L, W: d.W, params: spec.params, side, integrate: integ, openings: op });
  return engraveDisplay(buildProduct(p, { L: d.L, W: d.W, params: spec.params, side, ...z, color: state.color, strapColor: state.strapColor, upperColor: state.strapColor, integrate: integ, openings: op }), p);
}
// v9: show the engraved initials on single-body products (sandal soles, legacy insoles) in the 3D preview
const engDispCache = {};
function engraveDisplay(g, p) {
  const txt = designText(); if (!txt || !engraverReady() || !state.design) return g;
  const sole = g.children.find(o => o.name === 'sole'); if (!sole) return g;
  const key = [p.id, txt, sole.geometry.attributes.position.count, sole.geometry.attributes.position.array[0], sole.geometry.attributes.position.array[7]].join('|');
  let eg = engDispCache.k === key ? engDispCache.g : null;
  if (!eg) { const src = new THREE.BufferGeometry(); src.setAttribute('position', sole.geometry.attributes.position.clone()); src.setIndex(sole.geometry.index.clone());
    const r = engraveSingle(mergeForCsg(src), p); if (!r.info || r.info.error) { engDispCache.info = r.info; return g; } eg = toCreasedNormals(r.geo, Math.PI / 5); engDispCache.k = key; engDispCache.g = eg; engDispCache.info = r.info; }
  sole.geometry.dispose(); sole.geometry = eg.clone(); sole.material = new THREE.MeshStandardMaterial({ color: state.color, roughness: .7, side: THREE.DoubleSide });
  return g;
}
function mergeForCsg(g) { const P = g.attributes.position, I = g.index.array, map = new Map(), pos = [], idx = new Uint32Array(I.length); const remap = new Int32Array(P.count);
  for (let i = 0; i < P.count; i++) { const k = P.getX(i).toFixed(4) + ',' + P.getY(i).toFixed(4) + ',' + P.getZ(i).toFixed(4); let v = map.get(k); if (v === undefined) { v = pos.length / 3; map.set(k, v); pos.push(P.getX(i), P.getY(i), P.getZ(i)); } remap[i] = v; }
  for (let i = 0; i < I.length; i++) idx[i] = remap[I[i]]; const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setIndex(new THREE.BufferAttribute(idx, 1)); return o; }
// fit check: product top vs scanned plantar surface
const fitCache = {};
function fitFor(side) {
  const md = footModel(side); if (!md || !state.feet[side]) return null;
  const spec = currentSpec(side), key = JSON.stringify([state.product?.id, state.base, state.sizeMode, state.integrate, state.totalContact, spec.params, state.feet[side].mapId, md.L, archOf(side)]);
  if (fitCache[side]?.key === key) return fitCache[side].v;
  const obj = productObject(side, spec, { display: false, openings: false });
  const geo = obj.isMesh ? obj.geometry : null; let v = null;
  if (geo) { try { v = { md, spec, geo, fit: fitCheck(md, geo, state.product?.model ? { ...spec.params, _model: state.product.model } : spec.params), scanBased: !!scanModel(side) }; } catch (e) { console.warn('fit', e); } }
  fitCache[side] = { key, v }; return v;
}
function renderResult(keepView = true) {
  const p = state.product; if (!p) return show('s-products');
  const f = mainFoot(), spec = currentSpec(), dims = productDims(f.side);
  $('#resultTitle').textContent = p.name; $('#resultSide').textContent = sideName(f.side) + ' · EU ' + dims.eu;
  $('#resultSideSeg').classList.toggle('hidden', Object.keys(state.feet).length < 2);
  $$('#resultSideSeg .seg-btn').forEach(b => { b.classList.toggle('active', b.dataset.s === f.side); b.onclick = () => { state.side = b.dataset.s; state.highlight = null; renderResult(); }; });
  const scanEU = sizeFromLength(f.length).eu;
  $('#sizeSel').innerHTML = `<option value="scan">From scan – EU ${scanEU} (foot ${f.length} mm)</option>` + Array.from({ length: 13 }, (_, i) => 35 + i).map(eu => `<option value="${eu}">EU ${eu} · US M ${eu - 33} / W ${eu - 31.5} (${lengthFromEU(eu)} mm)</option>`).join('');
  $('#sizeSel').value = state.sizeMode;
  $('#dimsNote').textContent = `Print outline: ${dims.L} × ${dims.W} mm (foot length + ${dims.L - dims.footL} mm allowance).`;
  $('#archOverride2').value = archOf(f.side);
  $('#integrateWrap').classList.toggle('hidden', p.kind === 'insole');
  productViewer ||= new Viewer($('#productViewer'));
  const useTpl = state.base && tplKind(p) && templateCache[state.base];
  $('#templateSel').disabled = !tplKind(p);
  const obj = productObject(f.side, spec);
  productViewer.set(obj, keepView && !!productViewer.obj); $('#templateSel').value = tplKind(p) ? state.base : '';
  renderSuggestion(p);
  // colours
  if (state.design) { renderDesignRows($('#colorRow'), () => renderResult()); $('#strapRow').classList.add('hidden'); }
  else $('#colorRow').innerHTML = 'Colour ' + p.colors.map(c => `<span class="sw ${c === state.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('');
  if (!state.design) $$('#colorRow .sw').forEach(s => s.onclick = () => { state.color = s.dataset.c; renderResult(); });
  if (!state.design) $('#strapRow').classList.toggle('hidden', !p.strapColors);
  if (p.strapColors && !state.design) { $('#strapRow').innerHTML = 'Strap ' + p.strapColors.map(c => `<span class="sw ${c === state.strapColor ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join(''); $$('#strapRow .sw').forEach(s => s.onclick = () => { state.strapColor = s.dataset.c; renderResult(); }); }
  // zone chips
  $('#zoneChips').innerHTML = spec.zones.map(z => `<button class="zchip ${state.highlight?.length === 1 && state.highlight[0] === z.id ? 'on' : ''}" data-z="${z.id}"><i style="background:${z.color}"></i>${state.staff ? z.label : (ZONE_FRIENDLY[z.id] || z.label)}</button>`).join('');
  $$('#zoneChips .zchip').forEach(b => b.onclick = () => { const z = b.dataset.z; state.highlight = state.highlight?.length === 1 && state.highlight[0] === z ? null : [z]; state.showZones = true; $('#zonesToggle').classList.add('on'); renderResult(); });
  // condition cards
  const at = R.ARCH_TYPES[spec.archType];
  renderFeetSummary(spec);
  const cards = [{ id: '_arch', name: 'Your arch: ' + R.ARCH_FRIENDLY[spec.archType], explain: R.ARCH_FRIENDLY_TEXT[spec.archType], zones: ['medialArch', ...(spec.params.medialPost ? ['medialHeel'] : [])] },
    ...spec.conditions.map(id => R.CONDITIONS.find(c => c.id === id))];
  $('#condCards').innerHTML = cards.map(c => { const col = R.ZONES[c.zones[0]]?.color || '#0099ff'; const on = state.highlight && state.highlight.join() === c.zones.join();
    return `<div class="ccard ${on ? 'on' : ''}" data-zones="${c.zones.join(',')}" style="border-left-color:${col}"><b>${R.FRIENDLY[c.id] || c.name}</b> <small class="staff-only muted">${c.id === '_arch' ? '' : c.name}</small><p>${c.explain}</p></div>`; }).join('');
  $$('#condCards .ccard').forEach(el => el.onclick = () => { const zs = el.dataset.zones.split(','); state.highlight = state.highlight?.join() === zs.join() ? null : zs; state.showZones = true; $('#zonesToggle').classList.add('on'); renderResult(); });
  // params table (flash changed values)
  const prev = state.lastParams; state.lastParams = spec.params;
  $('#paramsTable').innerHTML = PARAM_ROWS.map(([label, fn]) => { const v = fn(spec.params), changed = prev && fn(prev) !== v; return `<tr class="${changed ? 'flash' : ''}"><td>${label}</td><td>${v}</td></tr>`; }).join('');
  $('#conflictBox').innerHTML = [...spec.conflicts.map(c => `<div class="alert warn">⚖️ ${c}</div>`), spec.notes.length ? `<div class="alert info"><b>Notes for production</b><ul>${spec.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''].join('');
}
$('#archOverride2').onchange = e => { state.archOverride[mainFoot().side] = e.target.value; renderResult(); toast('Support updated for ' + R.ARCH_TYPES[e.target.value].short); };
$('#zonesToggle').onclick = () => { state.showZones = !state.showZones; state.highlight = null; $('#zonesToggle').classList.toggle('on', state.showZones); renderResult(); };
const TEMPLATES = { L90: { url: 'assets/templates/fixifoot-L90-full-length-R.stl', full: true }, S90: { url: 'assets/templates/fixifoot-S90-three-quarter-R.stl', full: false } };
const templateCache = {};
async function loadTemplate(id) { if (!templateCache[id]) templateCache[id] = new STLLoader().parse(await (await fetch(TEMPLATES[id].url)).arrayBuffer()); return templateCache[id]; }
function templateGeo(side, spec, display) {
  const t = TEMPLATES[state.base], d = productDims(side);
  return adaptTemplate(templateCache[state.base], { footL: d.footL, W: d.W, params: spec.params, side, fullLengthTemplate: t.full, zones: display ? spec.zones : [], showZones: display && state.showZones, highlight: state.highlight, color: state.color });
}
$('#templateSel').onchange = async e => {
  state.base = e.target.value;
  if (state.base) { try { toast('Loading template…'); await loadTemplate(state.base); } catch (err) { toast('Could not load template: ' + err.message); state.base = ''; } }
  renderResult(false);
};
$('#sizeSel').onchange = e => { state.sizeMode = e.target.value; renderResult(); };
$('#integrateChk').onchange = e => { state.integrate = e.target.checked; renderResult(); };

/* ---------------- order ---------------- */
function priceLines(spec) {
  const p = state.product, pp = spec.params;
  if (state.design) return [[p.name + ' (pair) – your design', priceOf(p.id)]]; // v9: one price per product (₱9,999 for now), add-ons included
  const addons = [pp.metPad && 'Metatarsal pad', pp.heelLift && 'Heel lift', pp.mortonExtension && "Morton's extension", pp.lateralFlange && 'Lateral flange', pp.toeCrest && 'Toe crest', pp.sesamoidCutout && "Dancer's pad", pp.offloadPockets && 'Offloading pockets', pp.dualDensity && 'Dual density'].filter(Boolean);
  const lines = [[p.name + ' (pair)', p.examplePrice], ...addons.map(a => [a, R.ADDON_EXAMPLE_PRICE])];
  if (p.kind !== 'insole' && state.integrate) lines.push(['Custom footbed built into sole', 300]);
  return lines;
}
function renderOrder() {
  const cur = crmAll().find(x => x.id === state.customerId); if (cur) { $('#custName').value ||= cur.name; $('#custPhone').value ||= cur.phone || ''; $('#custEmail').value ||= cur.email || ''; }
  const pm = $('#payMethod'); if (pm.options.length < 2) pm.innerHTML += PAY_METHODS.map(m => `<option>${m}</option>`).join('');
  const p = state.product, f = mainFoot(), spec = currentSpec(), sz = sizeFromLength(productDims(longestFoot().side).footL), dims = productDims(f.side);
  const condNames = spec.conditions.map(id => R.CONDITIONS.find(c => c.id === id).name);
  $('#summaryCard').innerHTML = `<div class="row-between" style="margin-bottom:10px"><b>${p.name}</b><span class="sw" style="background:${state.color};width:28px;height:28px"></span></div>
    ${state.design ? designDl() : ''}<dl><dt>Feet</dt><dd>${Object.keys(state.feet).map(s => sideName(s) + ' (' + (SRC_LABEL[state.feet[s].source] || state.feet[s].source) + ')').join(' + ')}</dd><dt>Size</dt><dd>EU ${sz.eu} · US M ${sz.usM} / W ${sz.usW}</dd><dt>Print outline</dt><dd>${dims.L} × ${dims.W} mm</dd>
    <dt>Arch type</dt><dd>${R.ARCH_TYPES[spec.archType].short}</dd><dt>Material</dt><dd>TPU ${spec.params.shore}${spec.params.dualDensity ? ' + soft top' : ''}</dd>
    <dt>Arch / heel cup</dt><dd>${spec.params.archHeight} / ${spec.params.heelCupDepth} mm</dd><dt>Posting</dt><dd>${spec.params.medialPost ? 'medial ' + spec.params.medialPost + '°' : spec.params.lateralWedge ? 'lateral ' + spec.params.lateralWedge + '°' : 'none'}</dd>
    <dt>Problems</dt><dd>${condNames.length ? condNames.join(', ') : 'none selected'}</dd></dl>
    ${spec.params.referClinician ? '<div class="alert warn">Recommend a podiatrist / doctor check before and after fitting.</div>' : ''}`;
  const lines = priceLines(spec), total = lines.reduce((s, l) => s + l[1], 0);
  $('#priceTotal').textContent = peso(total);
  $('#priceLines').innerHTML = lines.map(l => `<div class="row-between"><span>${l[0]}</span><span>${peso(l[1])}</span></div>`).join('') + (state.design ? '<p>Includes your custom fit, all support features and your colours. Pay at the counter: cash, GCash, Maya, card or bank transfer.</p>' : '<p>Estimate – final price confirmed by our staff.</p>');
  $('#priceTag').classList.toggle('hidden', !!state.design);
}
function download(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
/* ---------------- production export (shared by order + staff dashboard) ---------------- */
const newOrderId = () => 'FXF-' + Date.now().toString(36).toUpperCase();
function ensureProduct() { if (!state.product) { state.product = R.PRODUCTS.find(x => x.id === 'fullcontact'); state.color = state.product.colors[0]; } return state.product; }
function buildStl(side, id) {
  const p = ensureProduct(), sp = currentSpec(side), md = scanModel(side);
  const useTpl = !!(state.base && tplKind(p) && templateCache[state.base]);
  const name = `${id}-${p.id}-${p.kind === 'insole' ? 'insole' : 'sole'}-${sideName(side).toLowerCase()}.stl`;
  if (md && (useTpl || p.kind === 'insole' || state.integrate)) {
    // scan-accurate path: total-contact sole / morphed template, converted to Z-up, Z=0, outward normals
    const obj = productObject(side, sp, { display: false, openings: true }), A = obj.userData?.anchors;
    const pts = A && p.kind === 'flipflop' ? [A.post, A.endM, A.endL] : A && p.kind === 'slide' ? [A.endM, A.endL] : [];
    const eng = engraveSingle(mergeForCsg(obj.geometry), p);
    const pr = toPrintable(eng.geo, pts), fv = fitFor(side);
    if (eng.info && !eng.info.error) { const c = ensureClosed(pr.geometry); pr.geometry = c.geo; eng.info.watertightCheck = c.fixed >= 0; if (c.fixed > 0) eng.info.sliverCleanups = (eng.info.sliverCleanups || 0) + c.fixed; }
    const info = { file: name, side: sideName(side), units: 'mm', zUp: true, restsOnZ0: true, flatBottomZ0: !useTpl, watertight: true,
      base: useTpl ? `template ${state.base} morphed to scan (piecewise u-warp heel/arch/ball/toe + width + Z conform)` : 'total-contact sole from 2 mm plantar map',
      totalContact: true, fromScan: true, archFillPct: sp.params.archFill ?? 100, ...pr.stats,
      allowanceMm: ALLOW[p.kind] || ALLOW.insole, lastLengthMm: lastLenFor(p.kind),
      landmarks: { footLengthMm: md.L, ballWidthMm: md.W, heelWidthMm: md.heelW, archApexPct: Math.round(md.archU * 100), archHeightMm: md.archH, ballLinePct: Math.round(md.ballU * 100), toeGapDetected: md.toeGap.detected },
      fit: fv ? { verdict: fv.fit.verdict, ...fv.fit.stats, placementTilt: fv.fit.tilt, modifiedZones: fv.fit.modStats.map(m => ({ name: m.name, meanGapMm: m.mean, areaCm2: m.areaCm2 })) } : null };
    if (obj.userData?.openings) info.openings = obj.userData.openings;
    if (eng.info) info.engraving = eng.info;
    if (pts.length) info.strapHolesMm = Object.fromEntries((p.kind === 'flipflop' ? ['toePost', 'medialStrap', 'lateralStrap'] : ['medialStrapEdge', 'lateralStrapEdge']).map((k, i) => [k, { x: +pr.points[i].x.toFixed(1), y: +pr.points[i].y.toFixed(1), zTop: +pr.points[i].z.toFixed(1) }]));
    return { name, info, data: new STLExporter().parse(new THREE.Mesh(pr.geometry), { binary: true }) };
  }
  const d = productDims(side);
  const solid = useTpl ? (() => { const g = templateGeo(side, sp, false); const m = new THREE.Mesh(g); m.userData.stats = { ...g.userData.stats }; return m; })()
    : buildPrintableSole(p, { L: d.L, W: d.W, params: sp.params, side, integrate: p.kind === 'insole' || state.integrate, openings: openingsFor(p) });
  let engInfo = null;
  if (!useTpl && designText()) { // v9: engrave in the Y-up frame, then back to Z-up / Z=0
    const g0 = mergeForCsg(solid.geometry); g0.rotateX(-Math.PI / 2); const r = engraveSingle(g0, p); engInfo = r.info;
    if (r.info && !r.info.error) { const g1 = r.geo; g1.rotateX(Math.PI / 2); g1.computeBoundingBox(); g1.translate(0, 0, -g1.boundingBox.min.z); const c = ensureClosed(g1); r.info.watertightCheck = c.fixed >= 0; if (c.fixed > 0) r.info.sliverCleanups = (r.info.sliverCleanups || 0) + c.fixed; solid.geometry = c.geo; }
  }
  const info = { file: name, ...(engInfo ? { engraving: engInfo } : {}), side: sideName(side), totalContact: false, units: 'mm', zUp: true, restsOnZ0: true, flatBottomZ0: !useTpl, base: useTpl ? 'template ' + state.base + ' (uniform scale)' : 'parametric', fromScan: !!state.feet[side], ...solid.userData.stats, ...(solid.userData.openings ? { openings: solid.userData.openings } : {}) };
  return { name, info, data: new STLExporter().parse(solid, { binary: true }) };
}
function buildSpec(id, stlInfos = []) {
  const p = ensureProduct(), feet = Object.keys(state.feet);
  const perFoot = feet.map(s => { const sp = currentSpec(s); return { side: sideName(s), scan: { ...state.feet[s], map: state.feet[s].map ? `${state.feet[s].map.nx}×${state.feet[s].map.nz} plantar height map @ ${state.feet[s].map.res} mm (stored)` : null, plantar: undefined }, totalContact: !!sp.totalContact, archType: sp.archType, params: sp.params, clinicalRationale: R.rationale(sp, { totalContact: sp.totalContact, scanArchH: sp.scanArchH }).map(r => ({ title: r.title, value: r.value, why: r.why, sources: r.refs.map(x => x.url) })), zones: sp.zones.map(z => ({ id: z.id, label: z.label, reasons: z.reasons })), notes: sp.notes, conflicts: sp.conflicts }; });
  const spec = currentSpec(), lines = priceLines(spec);
  return { orderId: id, brand: 'Fixifoot Philippines', feetSource: Object.fromEntries(feet.map(s => [sideName(s), SRC_LABEL[state.feet[s].source] || state.feet[s].source])), testData: feet.some(s => ['sample', 'demo'].includes(state.feet[s].source)) || undefined, createdAt: new Date().toISOString(), product: { id: p.id, name: p.name, color: state.color, strapColor: state.strapColor || null, footbedIntegrated: p.kind === 'insole' || state.integrate, base: state.base || 'parametric', openings: openingsFor(p) && !(state.base && tplKind(p)) ? { ...OPENING_PRESETS[openingsFor(p).mode][state.openings.density], ...openingsFor(p) } : null },
    size: sizeFromLength(longestFoot().length), questionnaire: state.answers, questionnaireRaw: state.qa, conditions: spec.conditions, feet: perFoot,
    examplePrice: { currency: 'PHP', lines, total: lines.reduce((s, l) => s + l[1], 0), note: state.design ? 'product price (configurable per product)' : 'estimate' },
    design: state.design ? designSummary() : null,
    price: { currency: 'PHP', amount: lines.reduce((s, l) => s + l[1], 0), perProduct: state.design ? priceOf(p.id) : null },
    dualMaterial: p.dual ? { look: p.dual.look, bodies: p.dual.bodies.map(b => ({ id: b.id, name: b.name, material: b.material, color: b.color, colorName: b.colorName, extruder: b.extruder, infill: b.infill })), files: '2-material 3MF (both bodies assembled in place) + one STL per body; single-STL export kept' } : null,
    print: p.print ? { model: p.name, ...p.print, printer: 'e.g. Creality K1C (220×220 bed – place insole diagonally)', note: 'Verify in the slicer before printing' } : { material: 'TPU ' + spec.params.shore, infill: spec.params.infill, walls: 3, nozzleTempC: '220-235', printer: 'e.g. Creality K1C (220×220 bed – place insole diagonally)', note: 'Verify in the slicer before printing' },
    model: p.model ? { id: p.id, name: p.name, tagline: p.tagline, geometry: { ...p.model, recesses: (p.model.recesses || []).map(r => ({ ...r })) }, forcedParams: p.params, smoothToes: true } : null,
    recommended: recommendNow(),
    stlFiles: stlInfos,
    stlNotes: [p.kind === 'flipflop' ? 'STL = sole/footbed only. Strap and toe post are separate parts.' : p.kind === 'slide' ? 'STL = sole/footbed only. Lattice upper is a separate part.' : 'STL = full insole solid.',
      openingMode(p) && openingsFor(p) && !(state.base && tplKind(p)) ? (openingMode(p) === 'holes' ? `Ventilation holes are REAL through-holes in the STL (Ø ${state.openings.d || 3.5} mm, ${OPENING_PRESETS.holes[state.openings.density].label}); heel cup, arch support and edge margin kept solid.` : `Lattice openings are REAL through-openings in the sole STL (${OPENING_PRESETS.lattice[state.openings.density].label}); solid rim and strap-anchor areas.`) : openingMode(p) ? (state.base && tplKind(p) ? 'Template base selected: ventilation holes are not cut into template models – use the parametric / scan sole for real holes.' : 'Openings switched off by staff: solid sole.') : null, state.base ? 'Template-based STL keeps the curved bottom of the original Fixifoot model.' : 'Parametric STL has a flat bottom on Z=0.'].filter(Boolean),
    disclaimer: 'Comfort product, not a medical diagnosis. See a podiatrist for diabetes or pain.' };
}
$('#sendBtn').onclick = () => {
  const id = newOrderId(), stls = Object.keys(state.feet).map(s => buildStl(s, id)), spec = buildSpec(id, stls.map(s => s.info));
  download(`${id}-spec.json`, JSON.stringify(spec, null, 2), 'application/json');
  stls.forEach((s, i) => setTimeout(() => download(s.name, s.data, 'model/stl'), 500 * (i + 1)));
  toast(`Order ${id}: spec + ${stls.length} STL file(s) downloaded`, 4000);
  recordOrder(id, 'production', spec, stls);
};
$('#orderBtn').onclick = () => {
  const name = $('#custName').value.trim(), phone = $('#custPhone').value.trim(), email = $('#custEmail').value.trim();
  if (!name) { toast('Please enter your name'); $('#custName').focus(); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Please check your email address'); $('#custEmail').focus(); return; }
  const id = newOrderId(); saveCurrentCustomer(name, phone, email); recordOrder(id, state.staff ? 'staff' : 'customer', null, [], state.staff ? payFromForm() : null);
  lastOrder = { customerId: state.customerId, orderId: id }; $('#thanksNo').textContent = 'Order no. ' + id;
  $('#thanks').classList.remove('hidden');
  const cf = $('#confetti'); cf.innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${['#0099ff', '#ffd22e', '#015ad8', '#5cc2ff', '#162327'][i % 5]};animation-delay:${Math.random() * 0.8}s"></i>`).join('');
};
$('#thanksDone').onclick = () => $('#thanks').classList.add('hidden');
let lastOrder = null;
function payFromForm() { return { method: $('#payMethod').value || null, paid: $('#payPaid').checked, discount: Math.max(0, Math.round(+$('#payDiscount').value || 0)), notes: $('#payNotes').value.trim() || null, staffName: staffName() || null }; }
$$('#thanksReceipt [data-rc]').forEach(b => b.onclick = () => { const c = lastOrder && crmAll().find(x => x.id === lastOrder.customerId), o = c?.orders?.find(x => x.id === lastOrder.orderId); if (!o) return toast('Order not found'); receiptAction(b.dataset.rc, c, o); });
$('#restartBtn').onclick = () => { location.reload(); };

/* ---------------- staff mode (PIN) + banner ---------------- */
const STAFF_PIN = String(window.FIXI_STAFF_PIN || '1234'); // offline fallback PIN (only used when the cloud is unreachable / not configured) – set window.FIXI_STAFF_PIN in config.js
function renderBanner() {
  const onStaffScreen = $('#s-staff').classList.contains('active');
  $('#modeBanner').innerHTML = state.staff
    ? `<span class="mb-label">🛠 STAFF VIEW${Cloud.configured ? (cloudOn() ? ' · ☁️' : ' · offline') : ''}</span>${onStaffScreen ? '' : '<button class="primary" id="mbDash">Staff dashboard</button>'}<button id="mbCust">👤 Customer view</button>`
    : `<span class="mb-label">👤 Customer view</span><button id="mbStaff">🛠 Switch to Staff view</button>`;
  $('#mbDash') && ($('#mbDash').onclick = () => show('s-staff'));
  $('#mbCust') && ($('#mbCust').onclick = () => setStaff(false));
  $('#mbStaff') && ($('#mbStaff').onclick = askPin);
  $('#staffBtn').textContent = state.staff ? '👤 Customer' : '🛠 Staff view';
}
function setStaff(on) {
  state.staff = on; document.body.classList.toggle('staff', on); sessionStorage.setItem('fxStaff', on ? '1' : '0'); syncTestMode();
  if (on) { toast('Staff view on'); show('s-staff'); }
  else { toast('Customer view'); if ($('#s-staff').classList.contains('active')) { state.history = state.history.filter(h => h !== 's-staff'); show(state.history[state.history.length - 1] || 's-welcome', false); } else { const act = document.querySelector('.screen.active'); if (act && onEnter[act.id] && !['s-scan'].includes(act.id)) onEnter[act.id](); } }
  renderBanner();
}
async function askPin() {
  if (!Cloud.configured) return askPinLocal('Cloud sync is not set up on this device – offline mode. Customers and orders stay on this device.');
  if (navigator.onLine !== false && Cloud.client) { sheet('<h3>🛠 Staff</h3><p class="muted">Connecting to the Fixifoot cloud…</p>'); if (await pingCloud()) return askLogin(); }
  askPinLocal('☁️ The Fixifoot cloud is unreachable right now (no internet?). Offline staff access with the shop PIN: customers and orders are saved on this device and can be uploaded from Customers when the cloud is back.');
}
function askLogin() {
  if (Cloud.session && Cloud.ready) { setStaff(true); return; }
  const inp = 'style="width:100%;font-size:17px;padding:12px;border-radius:12px;border:2px solid #e2e9f1;margin:4px 0"';
  if (Cloud.session && !Cloud.ready) {
    sheet(`<h3>⏳ Waiting for approval</h3><p class="muted">You are signed in as <b>${esc(Cloud.session.user.email)}</b>, but an admin has not approved this staff account yet. Customer data stays hidden until then.</p><button class="btn primary big" id="lgRetry">Check again</button><button class="btn ghost" id="lgOut">Sign out</button>`);
    $('#lgRetry').onclick = async () => { await signOut().catch(() => {}); askLogin(); toast('Please sign in again'); };
    $('#lgOut').onclick = async () => { await signOut(); $('#sheet').classList.add('hidden'); };
    return;
  }
  sheet(`<h3>🛠 Staff sign in</h3><p class="muted small">Staff accounts are stored in Fixifoot's secure cloud. Customers don't need to sign in.</p>
    <input id="lgEmail" type="email" autocomplete="username" placeholder="Email" ${inp}><input id="lgPass" type="password" autocomplete="current-password" placeholder="Password" ${inp}>
    <input id="lgName" placeholder="Your name (for new accounts)" class="hidden" ${inp}>
    <p class="tiny" id="lgMsg" style="min-height:1.2em"></p>
    <button class="btn primary big" id="lgIn">Sign in</button>
    <div class="crm-actions"><button class="btn ghost" id="lgUp">Create staff account</button><button class="btn ghost" id="lgForgot">Forgot password</button></div>
    <p class="tiny muted">New accounts must confirm their email and be approved by an admin.</p>`);
  const msg = (t, bad) => { $('#lgMsg').textContent = t; $('#lgMsg').style.color = bad ? '#c0392b' : '#0a7d3b'; };
  const vals = () => ({ email: $('#lgEmail').value.trim(), pass: $('#lgPass').value });
  const go = async () => { const { email, pass } = vals(); if (!email || !pass) return msg('Enter email and password', true); msg('Signing in…');
    try { const p = await signIn(email, pass); if (!Cloud.ready) { msg(p ? 'Account pending admin approval.' : 'No staff profile found.', true); return; } $('#sheet').classList.add('hidden'); setStaff(true); }
    catch (e) { if (/fetch|network|Failed/i.test(e.message) && !(await pingCloud())) return askPin(); msg(e.message, true); } };
  $('#lgIn').onclick = go; $('#lgPass').onkeydown = e => e.key === 'Enter' && go();
  $('#lgUp').onclick = async () => { const nm = $('#lgName'); if (nm.classList.contains('hidden')) { nm.classList.remove('hidden'); $('#lgUp').textContent = 'Create account now'; return msg('Enter email, a password (8+ chars) and your name'); }
    const { email, pass } = vals(); if (!email || pass.length < 8) return msg('Email and a password of 8+ characters needed', true);
    try { const r = await signUp(email, pass, nm.value.trim()); msg(r.needsConfirm ? 'Check your email to confirm, then ask an admin to approve you.' : 'Account created – waiting for admin approval.'); } catch (e) { msg(e.message, true); } };
  $('#lgForgot').onclick = async () => { const { email } = vals(); if (!email) return msg('Enter your email first', true); try { await resetPassword(email); msg('Password reset email sent.'); } catch (e) { msg(e.message, true); } };
  setTimeout(() => $('#lgEmail').focus(), 50);
}
function askPinLocal(note) {
  sheet(`<h3>🛠 Staff view (offline)</h3><p class="alert warn small">${esc(note)}</p><input id="pinIn" type="password" inputmode="numeric" maxlength="6" placeholder="Enter PIN" style="width:100%;font-size:22px;padding:14px;border-radius:14px;border:2px solid #e2e9f1;text-align:center;letter-spacing:6px"><button class="btn primary big" id="pinOk">Open staff dashboard</button>`);
  const ok = () => { if ($('#pinIn').value === STAFF_PIN) { $('#sheet').classList.add('hidden'); setStaff(true); } else { $('#pinIn').value = ''; $('#pinIn').placeholder = 'Wrong PIN'; } };
  $('#pinOk').onclick = ok; $('#pinIn').onkeydown = e => e.key === 'Enter' && ok(); setTimeout(() => $('#pinIn').focus(), 50);
}
$('#staffBtn').onclick = () => (state.staff ? setStaff(false) : askPin());

/* ---------------- staff dashboard ---------------- */
let staffViewer;
function loadDemoCustomer() {
  if (!state.staff || !testMode()) return;
  makeSampleFoot('R'); makeSampleFoot('L');
  state.qa = { pain: ['heel', 'ball'], toes: ['none'], diabetes: 'no', shoewear: 'inner', standing: '8+', activity: 'moderate', weight: '60-90', other: ['none'] };
  ensureProduct(); recompute(); renderStaff(false);
}
$('#loadDemoBtn').onclick = loadDemoCustomer;
$('#emptyScanBtn').onclick = () => $('#crmNewBtn').click();
function renderStaff(keepView = true) {
  renderSettings(); syncTestMode();
  const has = Object.keys(state.feet).length > 0;
  $('#staffEmpty').classList.toggle('hidden', has); $('#staffBody').classList.toggle('hidden', !has);
  if (!has) return;
  recompute(); const p = ensureProduct();
  if (!state.feet[state.side]) state.side = Object.keys(state.feet)[0];
  const side = state.side, f = state.feet[side], spec = currentSpec(side), d = productDims(side);
  $$('#staffSideSeg .seg-btn').forEach(b => { b.classList.toggle('active', b.dataset.s === side); b.onclick = () => { state.side = b.dataset.s; state.highlight = null; renderStaff(); }; });
  // customer
  $('#staffCustomer').innerHTML = `<dl class="summary"><dt>Feet</dt><dd>${['L', 'R'].map(s => state.feet[s] ? `${sideName(s)} ${state.feet[s].length}×${state.feet[s].width} mm (${SRC_LABEL[state.feet[s].source] || state.feet[s].source})` : `${sideName(s)}: not scanned`).join('<br>')}</dd>
    <dt>Size</dt><dd>EU ${sizeFromLength(longestFoot().length).eu}</dd><dt>Diabetes</dt><dd>${state.answers.diabetes}</dd><dt>On feet</dt><dd>${state.answers.standing} h</dd><dt>Activity</dt><dd>${state.answers.activity}</dd><dt>Weight</dt><dd>${state.answers.weight}</dd></dl>`;
  // arch
  $('#staffArch').innerHTML = ['L', 'R'].filter(s => state.feet[s]).map(s => `<div class="row-between" style="margin:6px 0"><b>${sideName(s)}</b><span class="tiny muted">scan: ${R.ARCH_TYPES[state.feet[s].archType].short} · CSI ${state.feet[s].csi}% · AHI ${state.feet[s].ahi}</span></div>
    <select data-side="${s}" class="staffArchSel">${Object.entries(R.ARCH_TYPES).map(([k, v]) => `<option value="${k}" ${archOf(s) === k ? 'selected' : ''}>${v.label}${state.archOverride[s] === k ? ' (override)' : ''}</option>`).join('')}</select>`).join('');
  $$('.staffArchSel').forEach(sel => sel.onchange = () => { state.archOverride[sel.dataset.side] = sel.value; renderStaff(); toast(sideName(sel.dataset.side) + ': ' + R.ARCH_TYPES[sel.value].short); });
  // problems
  $('#staffProblems').innerHTML = spec.conditions.length ? spec.conditions.map(id => { const c = R.CONDITIONS.find(x => x.id === id), src = state.sources[id]; const zs = c.zones.join(',');
    return `<button class="zchip" data-zones="${zs}"><i style="background:${R.ZONES[c.zones[0]]?.color || '#0099ff'}"></i>${c.name}<span class="badge-src ${src}">${src}</span></button>`; }).join('') : '<span class="muted">No problems detected or selected.</span>';
  $$('#staffProblems .zchip').forEach(b => b.onclick = () => { const zs = b.dataset.zones.split(','); state.highlight = state.highlight?.join() === zs.join() ? null : zs; renderStaff(); });
  renderConditions();
  // product + template
  $('#staffProduct').innerHTML = R.PRODUCTS.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${x.name}</option>`).join('');
  $('#staffTemplate').value = tplKind(p) ? state.base : ''; $('#staffTemplate').disabled = !tplKind(p);
  const om = openingMode(p); $('#openWrap').classList.toggle('hidden', !om);
  const rec = recommendNow(), pp = spec.params;
  $('#modelInfo').innerHTML = `<p class="tiny">⭐ Rule engine recommends: <b>${esc(R.PRODUCTS.find(x => x.id === rec.id)?.name || rec.id)}</b> – ${esc(rec.why)}${rec.id !== p.id ? ` <button class="linkbtn tiny" id="useRec">use it</button>` : ''}</p>` + (p.model ? `${p.preview ? `<figure class="print-prev"><img src="${p.preview}" alt="Actual print preview – ${esc(p.name)}"><figcaption class="tiny muted">Actual print preview (rendered from the real STL) · customer card uses an illustration</figcaption></figure>` : ''}<table class="params"><tr><td colspan="2"><b>Model geometry</b></td></tr>
    <tr><td>Thickness</td><td>${p.model.heelT} mm heel → ${p.model.foreT} mm forefoot${p.model.scaleWithSize ? ' (scaled by foot length)' : ''}</td></tr><tr><td>Length</td><td>${p.model.length === '3/4' ? '3/4 (ends ' + (p.model.frontMm ?? 6) + ' mm past met-head line)' : 'full length'}</td></tr>
    <tr><td>Arch</td><td>${p.model.archBoost ? '+' + p.model.archBoost + ' mm strong arch' : 'scan arch'} · fill ${pp.archFill ?? 100}%</td></tr><tr><td>Heel cup</td><td>${pp.heelCupDepth} mm</td></tr>
    <tr><td>Zones</td><td>${[(p.model.recesses || []).map(r => r.label + ' (' + r.depth + ' mm)').join(', '), pp.metPad && 'met pad', p.model.openings && 'ventilation holes', 'smooth toe area'].filter(Boolean).join(' · ')}</td></tr><tr><td>Edges</td><td>${p.model.rim} mm rounded rim</td></tr>
    <tr><td colspan="2"><b>TPU print settings</b></td></tr><tr><td>Material</td><td>${esc(p.print.base)}</td></tr><tr><td>Top layer</td><td>${esc(p.print.top)}</td></tr>
    <tr><td>Infill</td><td>${esc(p.print.pattern)} ${esc(p.print.infill)} · ${p.print.walls} walls · ${p.print.topLayers}/${p.print.bottomLayers} top/bottom · ${esc(p.print.layer)}</td></tr>
    ${p.print.zones.map(z => `<tr><td>${esc(z.zone)}</td><td>${esc(z.infill)} – ${esc(z.why)}</td></tr>`).join('')}
    <tr><td>Temps / speed</td><td>nozzle ${esc(p.print.nozzleC)} °C · bed ${esc(p.print.bedC)} °C · ${esc(p.print.speed)}</td></tr><tr><td>Note</td><td>${esc(p.print.notes)}</td></tr></table>` : '');
  const ur = $('#useRec'); if (ur) ur.onclick = () => { const pr = R.PRODUCTS.find(x => x.id === rec.id); state.product = pr; state.color = pr.colors[0]; state.strapColor = pr.strapColors?.[0]; if (state.design) { state.design.productId = pr.id; state.design.changedBy = 'staff'; applyDesign(); } renderStaff(false); };
  if (om) {
    $('#openLbl').textContent = om === 'holes' ? 'Real ventilation holes (cut into the STL)' : 'Real lattice openings (cut into the STL)';
    $('#openChk').checked = state.openings.on;
    $('#openDensity').innerHTML = Object.entries(OPENING_PRESETS[om]).map(([k, v]) => `<option value="${k}" ${k === state.openings.density ? 'selected' : ''}>${v.label}</option>`).join('');
    $('#openDensity').disabled = !state.openings.on;
    $('#openDiaWrap').classList.toggle('hidden', om !== 'holes');
    $('#openDia').innerHTML = HOLE_DIAMETERS.map(d => `<option value="${d}" ${+d === +(state.openings.d || 3.5) ? 'selected' : ''}>Ø ${d} mm</option>`).join(''); $('#openDia').disabled = !state.openings.on;
  }
  // 3D with zones
  staffViewer ||= new Viewer($('#staffViewer'));
  const useTpl = state.base && tplKind(p) && templateCache[state.base];
  const obj = productObject(side, spec, { zonesOn: true });
  staffViewer.set(obj, keepView && !!staffViewer.obj);
  if (om) { let st = null; obj.traverse?.(o => { if (o.userData?.openings) st = o.userData.openings; }); if (!st && obj.userData?.openings) st = obj.userData.openings;
    $('#openInfo').innerHTML = useTpl ? '⚠️ Not cut into template models – choose the parametric model for real openings.' : !state.openings.on ? 'Off – solid sole in preview and STL.' : st ? `${st.openings} ${om === 'holes' ? 'holes' : 'cells'} · open area ${st.openAreaPct}% · min wall ${st.minWallBetweenOpeningsMm ?? '–'} mm · rim ≥ ${st.minRimMm ?? '–'} mm · ${st.triangles.toLocaleString()} triangles` : ''; }
  $('#staffZoneChips').innerHTML = spec.zones.map(z => `<button class="zchip ${state.highlight?.length === 1 && state.highlight[0] === z.id ? 'on' : ''}" data-z="${z.id}"><i style="background:${z.color}"></i>${z.label}</button>`).join('');
  $$('#staffZoneChips .zchip').forEach(b => b.onclick = () => { const z = b.dataset.z; state.highlight = state.highlight?.length === 1 && state.highlight[0] === z ? null : [z]; renderStaff(); });
  // params + conflicts
  $('#staffParams').innerHTML = `<tr><td><b>${sideName(side)} foot</b></td><td>${R.ARCH_TYPES[spec.archType].short}</td></tr>` + PARAM_ROWS.map(([label, fn]) => `<tr><td>${label}</td><td>${fn(spec.params)}</td></tr>`).join('') + `<tr><td>Print outline</td><td>${d.L} × ${d.W} mm</td></tr>`;
  $('#staffConflicts').innerHTML = [...spec.conflicts.map(c => `<div class="alert warn">⚖️ ${c}</div>`), spec.notes.length ? `<div class="alert info"><b>Notes for production</b><ul>${spec.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''].join('');
  const cust = crmAll().find(x => x.id === state.customerId);
  $('#staffOrderTag').textContent = cust ? '👤 ' + cust.name : 'Not saved';
  $('#tcWrap').classList.remove('hidden'); $('#tcChk').checked = state.totalContact;
  $('#afWrap').classList.toggle('hidden', !spec.totalContact);
  $('#afRange').value = spec.params.archFill ?? 100; $('#afVal').textContent = (spec.params.archFill ?? 100) + '%' + (state.archFill == null ? ' (auto by condition)' : ' (staff)');
  const fv = fitFor(side), fs = fv?.fit.stats;
  $('#fitBadge').className = 'fit-badge ' + (fv ? fv.fit.verdict.toLowerCase() : 'na');
  $('#fitBadge').innerHTML = fv && fs ? `<b>${fv.fit.verdict}</b> mean gap ${fs.meanAbs} mm · ${fs.within1}% within 1 mm${fv.scanBased ? '' : ' · generic model'}` : 'Fit check n/a';
  $('#alignBtn').classList.toggle('hidden', !state.rawScans[side]);
  $('#staffRationale').innerHTML = R.rationale(spec, { totalContact: spec.totalContact, scanArchH: spec.scanArchH, length: useTpl && state.base === 'S90' ? '3/4 (sulcus) length – template S90' : p.kind === 'insole' ? 'full length' : 'full sole' }).map(r => `<div class="rat"><div class="row-between"><b>${r.title}</b><span class="tag">${r.value}</span></div><p>${r.why}</p>${r.refs.length ? `<small>Source: ${r.refs.map(x => `<a href="${x.url}" target="_blank" rel="noopener">${x.short}</a>`).join(' · ')}</small>` : ''}</div>`).join('');
  renderStaffDesign();
  $('#dualCard').classList.toggle('hidden', !p.dual); $('#twoMatChk').checked = state.twoMat;
  if (p.dual) { const dv = dualFor(side, spec); $('#dualInfo').innerHTML = dv ? `<p><b>${esc(p.dual.look)}</b></p><table class="params">${p.dual.bodies.map(b => `<tr><td><span class="sw" style="background:${b.color};width:14px;height:14px;display:inline-block;vertical-align:middle"></span> Extruder ${b.extruder}</td><td>${esc(b.name)} – ${esc(b.material)} (${esc(b.colorName)}), infill ${esc(b.infill)}</td></tr>`).join('')}
    <tr><td>Interface</td><td>shared surface – no gap / overlap; both bodies watertight</td></tr><tr><td>Features</td><td>${dv.stats.openings ? dv.stats.openings + ' ' + (dv.stats.tilesMode === 'holes' ? 'holes' : 'windows/cells') : ''}${dv.stats.inserts.length ? dv.stats.inserts.map(i => esc(i.label)).join(', ') : ''}${!dv.stats.openings && !dv.stats.inserts.length ? 'layered' : ''}</td></tr>
    <tr><td>Min thickness</td><td>${Object.entries(dv.stats.minThicknessMm).map(([k, v]) => k + ' ' + v + ' mm').join(' · ')}</td></tr></table>${p.actual ? `<figure class="print-prev"><img src="${p.actual}" alt="2-material print preview"><figcaption class="tiny muted">2-material preview rendered from the actual print files</figcaption></figure>` : ''}` : ''; }
  $('#dlStlL').textContent = `⬇ Download STL – Left${state.feet.L ? '' : ' (mirrored)'}`; $('#dlStlR').textContent = `⬇ Download STL – Right${state.feet.R ? '' : ' (mirrored)'}`;
  $('#dlNote').textContent = (spec.totalContact ? (useTpl ? `Template ${state.base} morphed to the scan (non-uniform warp + top conformed to the plantar map): watertight, mm, Z-up, Z=0 bottom.` : 'Total contact from the 2 mm plantar map: watertight, mm, Z-up, flat bottom on Z=0.') : useTpl ? `Template ${state.base}: watertight, mm, Z-up, curved bottom like the original.` : 'Parametric: watertight, mm, Z-up, flat bottom on Z=0.') + (p.kind !== 'insole' ? ' Sole only – strap/upper separate.' : '');
}
$('#tcChk').onchange = e => { state.totalContact = e.target.checked; renderStaff(); toast(state.totalContact ? 'Total contact ON – follows the scanned sole' : 'Total contact OFF – parametric arch'); };
$('#afRange').oninput = e => { state.archFill = +e.target.value; renderStaff(); };
$('#afAuto').onclick = () => { state.archFill = null; renderStaff(); };
$('#fitBtn').onclick = () => { state.fitSide = state.side; show('s-fit'); };
$('#fitBadge').onclick = () => { state.fitSide = state.side; show('s-fit'); };
$('#alignBtn').onclick = () => { state.alignSide = state.side; state.alignThen = false; show('s-align'); };

/* ---------------- staff: scan alignment ---------------- */
let alignViewer = null, fitViewer = null;
function renderAlign(keepView = false) {
  const side = state.feet[state.alignSide] && state.rawScans[state.alignSide] ? state.alignSide : ['R', 'L'].find(s => state.rawScans[s]);
  if (!side) { $('#alignInfo').innerHTML = '<tr><td colspan="2" class="muted">No uploaded scan in this session. Upload an STL/OBJ on the scan screen.</td></tr>'; return; }
  state.alignSide = side;
  const f = state.feet[side], info = f.align, md = footModel(side), up = state.uploaded[side];
  $('#alignSideTag').textContent = sideName(side) + ' foot · ' + f.file;
  alignViewer ||= new Viewer($('#alignViewer'), { free: true });
  const g = new THREE.Group();
  alignViewer.renderer.localClippingEnabled = true;
  const keepBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), info.trimAboveMm);
  g.add(new THREE.Mesh(up.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, side: THREE.DoubleSide, clippingPlanes: [keepBelow] })));
  g.add(new THREE.Mesh(up.geometry, new THREE.MeshStandardMaterial({ color: 0x9fb7cf, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide })));
  const span = Math.max(md.L, 120) * 1.25, grid = new THREE.GridHelper(span, Math.round(span / 10), 0x015ad8, 0x9fb7cf); grid.position.set((md.rowAt((md.zHeel + md.zToe) / 2).lo + md.rowAt((md.zHeel + md.zToe) / 2).hi) / 2, -0.2, (md.zHeel + md.zToe) / 2); g.add(grid);
  const trim = new THREE.Mesh(new THREE.PlaneGeometry(span * .8, span), new THREE.MeshBasicMaterial({ color: 0x0099ff, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false })); trim.rotation.x = -Math.PI / 2; trim.position.set(grid.position.x, info.trimAboveMm, grid.position.z); g.add(trim);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(grid.position.x + md.medialX * -(md.W * .75), 0.5, md.zHeel), md.L, 0xffd22e, 14, 8); g.add(arrow);
  alignViewer.set(g, keepView && !!alignViewer.obj);
  alignViewer.setLabels([{ text: 'Heel', pos: new THREE.Vector3(grid.position.x, 4, md.zHeel + 6) }, { text: 'Toe', pos: new THREE.Vector3(grid.position.x, 4, md.zToe - 8) }, { text: 'Medial', pos: new THREE.Vector3(grid.position.x + md.medialX * md.W * .62, 4, md.zOfU(.42)) }, { text: `trim ${info.trimAboveMm} mm`, pos: new THREE.Vector3(grid.position.x - md.medialX * md.W * .9, info.trimAboveMm, md.zOfU(.6)) }]);
  alignViewer.medialX = md.medialX;
  const n = state.nudge[side] || {};
  const rows = [['File', `${f.file} · ${info.triangles.toLocaleString()} triangles after clean-up`], ['Units', `${info.units} (largest size ${info.rawMaxDim} in file units → ×${info.scale})${n.unit ? ' · staff override' : ''}`],
    ['Floor plane', `RANSAC on lowest points · ${info.floorInliers}% inliers · tilt corrected ${info.tiltCorrectedDeg}°`], ['Heel / toe', info.heelToeMethod],
    ['Left / right', `${sideName(md.side)} – ${md.sideMethod}${n.mirror ? ' · mirrored by staff' : ''}`], ['Clean-up', `${info.removedPieces} loose piece(s) / ${info.removedTriangles.toLocaleString()} triangles removed · ankle/leg trimmed above ${info.trimAboveMm} mm (scan was ${info.heightMm} mm tall)`],
    ['Foot length', `${md.L} mm · ball width ${md.W} mm · heel width ${md.heelW} mm`], ['Arch', `apex at ${Math.round(md.archU * 100)}% of length, ${md.archH} mm high · CSI ${md.csi}% → ${R.ARCH_TYPES[archFromCSI(md.csi)].short}`],
    ['1st/2nd toe gap', md.toeGap.detected ? 'detected from toe outline' : 'not clear – estimated'], ['Plantar map', `${md.grid.nx}×${md.grid.nz} cells @ ${md.grid.res} mm`]];
  $('#alignInfo').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('');
  $('#alignNudge').textContent = Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${k}: ${v === true ? 'on' : v}`).join(' · ') || 'No manual corrections';
  $('#alignUnit').value = n.unit || '';
  drawAlignMap($('#alignCanvas'), md);
}
function drawAlignMap(cv, md) {
  const ctx = cv.getContext('2d'), G = md.grid, W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
  const s = Math.min((W - 16) / (G.nx * G.res), (H - 16) / (G.nz * G.res)), ox = (W - G.nx * G.res * s) / 2, oy = (H - G.nz * G.res * s) / 2;
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) { const h = G.raw[j * G.nx + i]; if (isNaN(h)) continue; const c = heatColor(Math.max(0, 1 - h / 22)); ctx.fillStyle = '#' + c.getHexString(); ctx.fillRect(ox + i * G.res * s, oy + j * G.res * s, G.res * s + .5, G.res * s + .5); }
  ctx.fillStyle = '#162327'; ctx.font = '11px sans-serif'; ctx.fillText('toe', W / 2 - 8, 12); ctx.fillText('heel', W / 2 - 10, H - 3);
}
function nudge(k, v) {
  const side = state.alignSide, n = { ...(state.nudge[side] || {}) };
  if (k === 'reset') Object.keys(n).forEach(x => delete n[x]); else if (typeof v === 'number') n[k] = +((n[k] || 0) + v).toFixed(1); else if (k === 'unit') n.unit = v || undefined; else n[k] = !n[k];
  state.nudge[side] = n;
  try { const ns = realign(side, n); state.alignSide = ns; if (ns !== side) toast(`Now detected as ${sideName(ns)} foot`); } catch (e) { console.error(e); toast('Alignment failed: ' + e.message); }
  renderAlign(true);
}
$$('#alignNudgeBtns [data-n]').forEach(b => b.onclick = () => nudge(b.dataset.n, b.dataset.v !== undefined ? +b.dataset.v : undefined));
$('#alignUnit').onchange = e => nudge('unit', e.target.value);
$$('#alignViews button').forEach(b => b.onclick = () => alignViewer?.view(b.dataset.view, true, alignViewer.medialX));
$('#alignOk').onclick = () => { if (state.alignThen) { state.alignThen = false; afterCapture(state.alignSide); } else show('s-staff'); };

/* ---------------- staff: fit check ---------------- */
function renderFit(keepView = false) {
  const sides = ['L', 'R'].filter(s => state.feet[s]); if (!sides.length) return;
  if (!state.feet[state.fitSide]) state.fitSide = sides[0];
  const side = state.fitSide;
  $$('#fitSideSeg .seg-btn').forEach(b => { b.classList.toggle('active', b.dataset.s === side); b.disabled = !state.feet[b.dataset.s]; b.onclick = () => { state.fitSide = b.dataset.s; renderFit(true); }; });
  const fv = fitFor(side);
  if (!fv) { $('#fitStats').innerHTML = '<tr><td class="muted">Fit check not available</td></tr>'; return; }
  const { md, fit, geo } = fv, st = fit.stats || {}, p = ensureProduct();
  $('#fitVerdict').textContent = fit.verdict; $('#fitVerdict').className = 'tag fit-' + fit.verdict.toLowerCase();
  $('#fitTitle').textContent = `${sideName(side)} foot · ${p.name}${state.base && tplKind(p) ? ' · template ' + state.base : ''}`;
  // 3D: product coloured by gap + ghost foot standing on it
  fitViewer ||= new Viewer($('#fitViewer'), { free: true });
  const grp = new THREE.Group();
  const g2 = colorByGap(geo.clone(), fit); g2.computeVertexNormals();
  grp.add(new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, side: THREE.DoubleSide })));
  if ($('#fitGhost').checked) {
    let fg; if (state.uploaded[side]) fg = state.uploaded[side].geometry.clone(); else { const o = buildFoot({ L: state.feet[side].length, W: state.feet[side].width, archType: archOf(side), side, peak: state.feet[side].peakForefootPressure }); o.traverse(m => { if (!fg && m.isMesh) fg = m.geometry.clone(); }); }
    const ghost = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0xe3b69c, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide }));
    ghost.position.y = fit.tilt.offsetMm; grp.add(ghost);
  }
  fitViewer.set(grp, keepView && !!fitViewer.obj); fitViewer.medialX = md.medialX;
  drawFitMap($('#fitCanvas'), md, fit);
  $('#fitStats').innerHTML = [['Contact area checked', `${st.areaCm2} cm² (${st.cells} cells @ ${md.grid.res} mm)`], ['Mean |gap|', `<b>${st.meanAbs} mm</b> (signed ${st.mean} mm)`], ['Within ±1 mm / ±2 mm', `<b>${st.within1}%</b> / ${st.within2}%`],
    ['Whole sole incl. modifications', fit.statsAll ? `${fit.statsAll.areaCm2} cm² · mean |gap| ${fit.statsAll.meanAbs} mm · ${fit.statsAll.within1}% within 1 mm` : '–'], ['Largest air gap', `${st.maxGap} mm`], ['Largest pressure (insole above foot)', `${st.maxPress} mm`], ['95th percentile |gap|', `${st.p95} mm`], ['Foot placement', `offset ${fit.tilt.offsetMm} mm · tilt ${fit.tilt.xDeg}° / ${fit.tilt.zDeg}°`],
    ['Model', fv.scanBased ? (state.base && tplKind(p) ? `template ${state.base} morphed to scan` : 'total contact from plantar map') : 'generic (total contact OFF)']].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('#fitMods').innerHTML = fit.modStats.length ? `<p class="tiny muted" style="margin:8px 0 4px">Intentional clinical modifications (excluded from the score, hatched on the map):</p><table class="params">${fit.modStats.map(m => `<tr><td>${m.name}</td><td>${m.areaCm2} cm² · mean ${m.mean > 0 ? '+' : ''}${m.mean} mm</td></tr>`).join('')}</table>` : '';
  $('#fitNote').textContent = fit.verdict === 'PASS' ? 'PASS: mean gap under 1 mm and at least 80% of the contact area within ±1 mm.' : fit.verdict === 'WARN' ? 'WARN: check the scan alignment, the shoe size (trimmed length) or the arch fill before printing.' : 'FAIL: the product does not follow this scan – turn total contact ON or re-check the scan.';
}
$('#fitGhost').onchange = () => renderFit(true);
$$('#fitViews button').forEach(b => b.onclick = () => fitViewer?.view(b.dataset.view, true, fitViewer.medialX));
$('#staffProduct').onchange = e => { const pr = R.PRODUCTS.find(x => x.id === e.target.value); state.product = pr; state.color = pr.colors[0]; state.strapColor = pr.strapColors?.[0]; if (state.design) { state.design.productId = pr.id; state.design.changedBy = 'staff'; applyDesign(); } renderStaff(false); };
$('#openChk').onchange = e => { state.openings.on = e.target.checked; renderStaff(); };
$('#openDensity').onchange = e => { state.openings.density = e.target.value; renderStaff(); };
$('#openDia').onchange = e => { state.openings.d = +e.target.value; renderStaff(); };
$('#staffTemplate').onchange = async e => { state.base = e.target.value; if (state.base) { try { toast('Loading template…'); await loadTemplate(state.base); } catch (err) { toast('Could not load template: ' + err.message); state.base = ''; } } renderStaff(false); };
let staffOrderId = null;
const getStaffOrderId = () => (staffOrderId ||= newOrderId());
$('#dlStlR').onclick = () => { const s = buildStl('R', getStaffOrderId()); download(s.name, s.data, 'model/stl'); toast('Right STL downloaded (' + s.info.sizeMm.join(' × ') + ' mm)'); };
$('#dlStlL').onclick = () => { const s = buildStl('L', getStaffOrderId()); download(s.name, s.data, 'model/stl'); toast('Left STL downloaded (' + s.info.sizeMm.join(' × ') + ' mm)'); };
$('#dl3mfR').onclick = () => dl3mf('R'); $('#dl3mfL').onclick = () => dl3mf('L');
function dl3mf(side) { const r = build3mfFor(side, getStaffOrderId()); if (!r) return toast('2-material export is for the Fixifoot insole line'); download(r.name, r.data, 'model/3mf'); toast(`2-material 3MF (${sideName(side)}) downloaded – ${r.bodies.map(b => b.colorName + ' → extruder ' + b.extruder).join(', ')}`, 4000); }
$('#dlBodiesR').onclick = () => dlBodies('R'); $('#dlBodiesL').onclick = () => dlBodies('L');
function dlBodies(side) { const f = bodyStls(side, getStaffOrderId()); f.forEach((s, i) => setTimeout(() => download(s.name, s.data, 'model/stl'), 400 * i)); toast(f.length + ' body STLs downloaded'); }
$('#twoMatChk').onchange = e => { state.twoMat = e.target.checked; renderStaff(); };
$('#dlSpec').onclick = () => { const id = getStaffOrderId(); const infos = ['R', 'L'].map(s => buildStl(s, id).info); download(`${id}-spec.json`, JSON.stringify(buildSpec(id, infos), null, 2), 'application/json'); toast('Spec downloaded'); };


/* ---------------- on-device CRM (localStorage; cloud when signed in) ---------------- */
const CRM_KEY = 'fxCRM_v1';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localAll = () => { try { return JSON.parse(localStorage.getItem(CRM_KEY)) || []; } catch { return []; } };
const localSave = list => { try { localStorage.setItem(CRM_KEY, JSON.stringify(list)); } catch (e) { toast('Could not save (storage full?)'); } };
// v5: when a Supabase staff session is active the CRM lives in the cloud (cached in memory); otherwise on this device.
let cloudList = [], cloudQueue = Promise.resolve();
const cloudOn = () => Cloud.configured && Cloud.online && Cloud.ready;
const crmAll = () => cloudOn() ? cloudList : localAll();
const crmSave = list => { if (cloudOn()) cloudList = list; else localSave(list); };
const cloudJob = (label, fn) => { cloudQueue = cloudQueue.then(fn).then(() => { $('#crmSync') && ($('#crmSync').textContent = '☁️ synced ' + new Date().toLocaleTimeString('en-PH', { timeStyle: 'short' })); }).catch(e => { console.warn(label, e); toast('Cloud ' + label + ' failed: ' + e.message, 4500); }); return cloudQueue; };
const newCustId = () => cloudOn() ? crypto.randomUUID() : 'C' + Date.now().toString(36).toUpperCase();
function rawMeshFiles() {
  const out = {};
  for (const sd of ['R', 'L']) { const r = state.rawScans[sd]; if (r?.geo && state.feet[sd]?.source === 'file') out[sd] = new Blob([new STLExporter().parse(new THREE.Mesh(r.geo), { binary: true })], { type: 'model/stl' }); }
  return out;
}
async function refreshCloud() { if (!cloudOn()) return; cloudList = await fetchCustomers(); }
const fmtDate = iso => new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
function snapshot() {
  const sp = Object.fromEntries(Object.keys(state.feet).map(s => [s, currentSpec(s)]));
  return {
    feet: JSON.parse(JSON.stringify(state.feet)), archOverride: { ...state.archOverride }, qa: JSON.parse(JSON.stringify(state.qa)), lld: { mm: state.answers.lldMm, side: state.answers.lldSide },
    staffAdds: [...state.staffAdds], staffRemoves: [...state.staffRemoves], conditions: [...state.conditions],
    settings: { design: state.design ? JSON.parse(JSON.stringify(state.design)) : null, productId: state.product?.id || null, color: state.color, strapColor: state.strapColor || null, base: state.base, sizeMode: state.sizeMode, integrate: state.integrate, totalContact: state.totalContact, openings: { ...state.openings },
      perFoot: Object.fromEntries(Object.entries(sp).map(([s, x]) => [s, { archType: x.archType, archHeight: x.params.archHeight, heelCupDepth: x.params.heelCupDepth, medialPost: x.params.medialPost, lateralWedge: x.params.lateralWedge, heelLift: x.params.heelLift, metPad: x.params.metPad, shore: x.params.shore }])) }
  };
}
function saveCurrentCustomer(name, phone, email) {
  const list = crmAll(), now = new Date().toISOString();
  let c = state.customerId && list.find(x => x.id === state.customerId);
  if (!c && phone) c = list.find(x => x.phone && x.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
  if (!c) { c = { id: newCustId(), createdAt: now, orders: [] }; list.unshift(c); }
  Object.assign(c, { name: name || c.name || 'Walk-in customer', phone: phone ?? c.phone ?? '', email: email ?? c.email ?? '', updatedAt: now }, snapshot());
  // v11: keep a dated scan history (one entry per distinct scan)
  c.scanHistory = c.scanHistory || []; c.tags = c.tags || [];
  for (const [sd, f] of Object.entries(state.feet)) { const sig = scanSig(f); if (!c.scanHistory.some(h => h.sig === sig)) c.scanHistory.push({ sig, side: sd, source: f.source, file: f.file || null, length: f.length, width: f.width, archType: f.archType, csi: f.csi, peakForefootPressure: f.peakForefootPressure, date: now }); }
  state.customerId = c.id; crmSave(list);
  if (cloudOn()) { const files = rawMeshFiles(); cloudJob('save', () => saveCustomerCloud(c, files)); }
  return c;
}
function recordOrder(id, by, spec = null, stls = [], pay = null) {
  const list = crmAll(); let c = list.find(x => x.id === state.customerId);
  if (!c) { c = saveCurrentCustomer($('#custName')?.value.trim() || 'Walk-in customer', $('#custPhone')?.value.trim() || '', $('#custEmail')?.value.trim() || ''); return recordOrder(id, by, spec, stls, pay); }
  const p = ensureProduct(), lines = priceLines(currentSpec());
  Object.assign(c, snapshot(), { updatedAt: new Date().toISOString() });
  c.orders = c.orders || []; if (!c.orders.some(o => o.id === id)) c.orders.unshift({ id, date: new Date().toISOString(), productId: p.id, product: p.name, color: state.color, base: state.base || 'parametric', sides: Object.keys(state.feet), total: lines.reduce((s, l) => s + l[1], 0), by, status: 'new', statusHistory: [{ status: 'new', at: new Date().toISOString(), by: (state.staff ? staffName() : null) || by }], ...(state.design ? { design: designSummary() } : {}),
    feetInfo: Object.fromEntries(Object.keys(state.feet).map(s => [s, { length: state.feet[s].length, source: state.feet[s].source }])), size: 'EU ' + sizeFromLength(productDims(longestFoot().side).footL).eu,
    payment: { method: pay?.method || null, paid: !!pay?.paid, discount: pay?.discount || 0, notes: pay?.notes || null, staffName: pay?.staffName || (state.staff ? staffName() : null) || null, receiptNo: id } });
  crmSave(list);
  if (cloudOn()) { const o = c.orders.find(o => o.id === id), sp = spec || buildSpec(id, stls.map(x => x.info)); cloudJob('order', () => saveCustomerCloud(c, rawMeshFiles()).then(() => insertOrderCloud(c, o, sp, stls))); }
}
function loadCustomer(c) {
  state.feet = JSON.parse(JSON.stringify(c.feet || {})); state.uploaded = {}; state.archOverride = { ...(c.archOverride || {}) };
  state.qa = JSON.parse(JSON.stringify(c.qa || {})); state.staffAdds = new Set(c.staffAdds || []); state.staffRemoves = new Set(c.staffRemoves || []);
  if (c.lld) { state.answers.lldMm = c.lld.mm; state.answers.lldSide = c.lld.side; }
  const s = c.settings || {}; state.product = R.PRODUCTS.find(x => x.id === s.productId) || null; state.color = s.color || state.product?.colors[0]; state.strapColor = s.strapColor || state.product?.strapColors?.[0];
  state.design = s.design ? JSON.parse(JSON.stringify(s.design)) : null; if (state.design) applyDesign();
  state.base = s.base || ''; state.sizeMode = s.sizeMode || 'scan'; state.integrate = s.integrate !== false; state.totalContact = s.totalContact !== false; state.openings = { on: true, density: 'med', d: 3.5, ...(s.openings || {}) };
  state.customerId = c.id; state.side = state.feet.R ? 'R' : 'L'; staffOrderId = null; recompute();
}
// v10: no fake customers in production; remove the old v1–v9 sample customers (C-DEMO*) from this device once
function seedCRM() { const l = localAll(); if (l.some(c => String(c.id).startsWith('C-DEMO'))) localSave(l.filter(c => !String(c.id).startsWith('C-DEMO'))); }
function problemNames(c) {
  // recompute problems for a stored customer without touching the live session
  const saved = { feet: state.feet, qa: state.qa, adds: state.staffAdds, rem: state.staffRemoves, ov: state.archOverride, ans: { ...state.answers }, cond: state.conditions, src: state.sources };
  state.feet = c.feet || {}; state.qa = c.qa || {}; state.staffAdds = new Set(c.staffAdds || []); state.staffRemoves = new Set(c.staffRemoves || []); state.archOverride = c.archOverride || {};
  recompute(); const out = [...state.conditions].map(id => R.CONDITIONS.find(x => x.id === id)?.name).filter(Boolean);
  out.perFoot = Object.fromEntries(Object.keys(state.feet).map(s => { const x = R.combine(state.archOverride[s] || state.feet[s].archType, [...state.conditions], state.answers).params; return [s, { archType: state.archOverride[s] || state.feet[s].archType, archHeight: x.archHeight, heelCupDepth: x.heelCupDepth, medialPost: x.medialPost, lateralWedge: x.lateralWedge, heelLift: x.heelLift, metPad: x.metPad, shore: x.shore }]; }));
  Object.assign(state, { feet: saved.feet, qa: saved.qa, staffAdds: saved.adds, staffRemoves: saved.rem, archOverride: saved.ov, answers: saved.ans, conditions: saved.cond, sources: saved.src });
  return out;
}
async function enterCRM() {
  if (cloudOn()) { $('#crmList').innerHTML = '<p class="muted center">Loading customers from the cloud…</p>'; try { await cloudQueue; await refreshCloud(); } catch (e) { toast('Could not load cloud customers: ' + e.message, 4500); } }
  renderCRM();
}
function renderCloudTools() {
  const el = $('#crmCloud'); if (!el) return;
  $('#crmTag').textContent = cloudOn() ? '☁️ Supabase cloud' : 'On this device';
  if (!cloudOn()) { el.innerHTML = ''; return; }
  const pending = localAll().filter(c => !String(c.id).startsWith('C-DEMO') && !c.seed);
  el.innerHTML = `<div class="staff-top">${pending.length ? `<button class="btn ghost" id="crmUpload">⬆️ Upload ${pending.length} on-device customer(s)</button>` : ''}${Cloud.isAdmin ? '<button class="btn ghost" id="crmStaffBtn">👥 Staff accounts</button>' : ''}<button class="btn ghost" id="crmSignOut">Sign out</button></div>`;
  $('#crmSignOut').onclick = async () => { await signOut(); cloudList = []; setStaff(false); toast('Signed out'); };
  $('#crmStaffBtn') && ($('#crmStaffBtn').onclick = openStaffAdmin);
  $('#crmUpload') && ($('#crmUpload').onclick = async () => {
    const btn = $('#crmUpload'); btn.disabled = true; btn.textContent = 'Uploading…'; let n = 0;
    for (const lc of pending) {
      try { const c = { ...JSON.parse(JSON.stringify(lc)), id: crypto.randomUUID(), scanSig: {} }; await saveCustomerCloud(c); for (const o of (lc.orders || []).slice().reverse()) await insertOrderCloud(c, o, null, []); n++; localSave(localAll().filter(x => x.id !== lc.id)); }
      catch (e) { toast('Upload failed for ' + lc.name + ': ' + e.message, 4500); break; }
    }
    toast(`${n} customer(s) uploaded to the cloud`); enterCRM();
  });
}
async function openStaffAdmin() {
  let rows = []; try { rows = await listStaff(); } catch (e) { toast(e.message); return; }
  sheet(`<h3>👥 Staff accounts</h3><p class="muted small">New sign-ups start as <b>pending</b> and see no customer data until you approve them.</p><div class="crm-orders">${rows.map(r => `<div class="row-between"><span><b>${esc(r.name || r.email)}</b><br><small class="muted">${esc(r.email)}</small></span><select data-uid="${esc(r.user_id)}" ${r.user_id === Cloud.session.user.id ? 'disabled' : ''}>${['pending', 'staff', 'admin'].map(x => `<option ${x === r.role ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`).join('')}</div>`);
  $$('#sheet select[data-uid]').forEach(sel => sel.onchange = async () => { try { await setRole(sel.dataset.uid, sel.value); toast('Role updated'); } catch (e) { toast(e.message); } });
}
/* ---------------- v11 CRM: customer card, order pipeline, reminders, reports, export ---------------- */
const STATUSES = [['new', 'New'], ['printing', 'Printing'], ['ready', 'Ready for pickup'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
const PIPE = ['new', 'printing', 'ready', 'delivered'];
const stLabel = k => (STATUSES.find(x => x[0] === k) || STATUSES[0])[1];
const ordStatus = o => o.status || 'new';
const ordHist = o => (o.statusHistory && o.statusHistory.length) ? o.statusHistory : [{ status: ordStatus(o), at: o.date }];
const statusSince = o => { const h = ordHist(o), st = ordStatus(o); for (let i = h.length - 1; i >= 0; i--) if (h[i].status === st) return h[i].at; return o.statusAt || o.date; };
const orderNet = o => Math.max(0, (+o.total || 0) - (+o.payment?.discount || 0));
const TAG_PRESETS = ['Diabetic', 'Athlete', 'VIP'];
const TEST_SRC = ['sample', 'demo'];
const isTestCust = c => /\btest\b/i.test(c.name || '') || (c.tags || []).some(t => /^test$/i.test(t)) || Object.values(c.feet || {}).some(f => TEST_SRC.includes(f.source));
const isTestOrder = (c, o) => isTestCust(c) || Object.values(o.feetInfo || {}).some(f => TEST_SRC.includes(f.source));
const dayKey = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso));
const daysAgo = iso => (Date.now() - new Date(iso).getTime()) / 864e5;
const dShort = iso => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
let crmTab = 'customers', ordView = 'board';
function crmFilters() { return { q: ($('#crmSearch').value || '').toLowerCase().trim(), tag: $('#fTag').value, product: $('#fProduct').value, status: $('#fStatus').value, from: $('#fFrom').value, to: $('#fTo').value }; }
function orderMatch(c, o, F, useQ = true) {
  if (useQ && F.q && ![c.name, c.phone, c.email, c.id, o.id, o.product].join(' ').toLowerCase().includes(F.q)) return false;
  if (F.tag && !(c.tags || []).includes(F.tag)) return false;
  if (F.product && o.productId !== F.product) return false;
  if (F.status && ordStatus(o) !== F.status) return false;
  const k = dayKey(o.date); if (F.from && k < F.from) return false; if (F.to && k > F.to) return false;
  return true;
}
function custMatch(c, F) {
  if (F.q && ![c.name, c.phone, c.email, c.id, (c.tags || []).join(' '), ...(c.orders || []).map(o => o.id + ' ' + o.product)].join(' ').toLowerCase().includes(F.q)) return false;
  if (F.tag && !(c.tags || []).includes(F.tag)) return false;
  if (F.product || F.status || F.from || F.to) return (c.orders || []).some(o => orderMatch(c, o, { ...F, tag: '' }, false));
  return true;
}
const allOrders = (list = crmAll()) => list.flatMap(c => (c.orders || []).map(o => ({ c, o }))).sort((a, b) => new Date(b.o.date) - new Date(a.o.date));
function fillFilterOptions(list) {
  const keepSel = (sel, opts) => { const v = sel.value; sel.innerHTML = sel.options[0].outerHTML + opts.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(''); sel.value = opts.some(o => o[0] === v) ? v : ''; };
  const tags = [...new Set([...TAG_PRESETS, ...list.flatMap(c => c.tags || [])])];
  keepSel($('#fTag'), tags.map(t => [t, t])); keepSel($('#fProduct'), R.PRODUCTS.map(p => [p.id, p.name])); keepSel($('#fStatus'), STATUSES);
  const F = crmFilters(), n = ['tag', 'product', 'status', 'from', 'to'].filter(k => F[k]).length; $('#crmFilterInfo').textContent = n ? `· ${n} active` : '';
}
function readyOverdue(list = crmAll()) { return allOrders(list).filter(({ o }) => ordStatus(o) === 'ready' && daysAgo(statusSince(o)) > 3); }
function replacementDue(list = crmAll()) {
  return list.map(c => { const os = (c.orders || []).filter(o => ordStatus(o) !== 'cancelled').sort((a, b) => new Date(b.date) - new Date(a.date)); return os[0] ? { c, o: os[0], age: daysAgo(os[0].date) } : null; })
    .filter(x => x && x.age >= 182 && x.age <= 366).sort((a, b) => b.age - a.age);
}
function renderCRM() {
  const list = crmAll(), F = crmFilters();
  fillFilterOptions(list); renderCloudTools();
  $$('#crmTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === crmTab));
  $$('#s-crm .crm-panel').forEach(p => p.classList.toggle('hidden', p.dataset.p !== crmTab));
  $('#crmFilters').classList.toggle('hidden', crmTab === 'reminders');
  const remN = readyOverdue(list).length + replacementDue(list).length; $('#remBadge').textContent = remN ? remN : '';
  const where = cloudOn() ? `in Supabase cloud · signed in as ${esc(Cloud.profile.email)} (${Cloud.profile.role}) <span id="crmSync"></span>` : Cloud.configured ? 'saved on this device (offline / not signed in)' : 'saved on this device';
  if (crmTab === 'customers') {
    const hits = list.filter(c => custMatch(c, F));
    $('#crmCount').innerHTML = `${hits.length} of ${list.length} customers · ${where}`;
    $('#crmList').innerHTML = hits.length ? hits.map(c => {
      const feet = ['R', 'L'].filter(s => c.feet?.[s]).map(s => `${s}: ${R.ARCH_TYPES[c.archOverride?.[s] || c.feet[s].archType]?.short} · ${c.feet[s].length} mm`).join(' &nbsp;|&nbsp; ');
      const last = (c.orders || [])[0];
      return `<div class="crm-item ${c.id === state.customerId ? 'on' : ''}" data-id="${esc(c.id)}"><div class="crm-av">${esc((c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
        <div class="crm-main"><b>${esc(c.name)}</b><span>${esc(c.phone || 'no phone')} · ${(c.orders || []).length} order(s)${last ? ` · <i class="st st-${ordStatus(last)}">${stLabel(ordStatus(last))}</i>` : ''}</span><small>${feet || 'no scan'}</small>${(c.tags || []).length ? `<span class="tagrow">${c.tags.map(t => `<i class="ctag ctag-${esc(t.toLowerCase())}">${esc(t)}</i>`).join('')}</span>` : ''}</div><span class="crm-go">›</span></div>`;
    }).join('') : '<p class="muted center">No customers found.</p>';
    $$('#crmList .crm-item').forEach(el => el.onclick = () => openCustomer(el.dataset.id));
  }
  if (crmTab === 'orders') renderOrders(list, F, where);
  if (crmTab === 'reminders') renderReminders(list);
  if (crmTab === 'reports') renderReports(list, F);
  if (crmTab === 'export') { const nc = list.filter(c => custMatch(c, F)).length, no = allOrders(list).filter(({ c, o }) => orderMatch(c, o, F)).length; $('#expInfo').textContent = `Will export ${nc} customer(s) and ${no} order(s) with the current filters.`; }
}
function renderOrders(list, F, where) {
  const rows = allOrders(list).filter(({ c, o }) => orderMatch(c, o, F));
  $('#ordCount').innerHTML = `${rows.length} order(s) · ${where}`;
  $$('#ordView button').forEach(b => b.classList.toggle('active', b.dataset.v === ordView));
  $('#ordBoard').classList.toggle('hidden', ordView !== 'board'); $('#ordList').classList.toggle('hidden', ordView !== 'list');
  const card = ({ c, o }) => { const st = ordStatus(o), i = PIPE.indexOf(st), d = Math.floor(daysAgo(statusSince(o)));
    return `<div class="kb-card${st === 'ready' && d > 3 ? ' late' : ''}" data-cid="${esc(c.id)}" data-oid="${esc(o.id)}"><div class="kb-top"><b>${esc(c.name)}</b><span>${peso(orderNet(o))}</span></div>
      <small>${esc(o.id)} · ${esc(o.product)}</small><small class="muted">${dShort(o.date)} · ${d < 1 ? 'today' : d + ' d'} in status${o.payment?.paid ? ' · ✅ paid' : ''}</small>
      <div class="kb-move">${i > 0 ? `<button class="btn ghost" data-mv="${PIPE[i - 1]}" title="Back to ${stLabel(PIPE[i - 1])}">◀</button>` : '<span></span>'}${st !== 'cancelled' && st !== 'delivered' ? `<button class="btn ghost kb-x" data-mv="cancelled" title="Cancel order">✕</button>` : st === 'cancelled' ? `<button class="btn ghost" data-mv="new" title="Re-open">↺</button>` : ''}${i >= 0 && i < PIPE.length - 1 ? `<button class="btn primary" data-mv="${PIPE[i + 1]}">${stLabel(PIPE[i + 1])} ▶</button>` : '<span></span>'}</div></div>`; };
  if (ordView === 'board') {
    $('#ordBoard').innerHTML = STATUSES.map(([k, n]) => { const col = rows.filter(r => ordStatus(r.o) === k); return `<div class="kb-col kb-${k}" data-st="${k}"><div class="kb-h"><b>${n}</b><span>${col.length}</span></div>${col.map(card).join('') || '<p class="tiny muted center">–</p>'}</div>`; }).join('');
    $$('#ordBoard .kb-card').forEach(el => { el.onclick = e => { const b = e.target.closest('[data-mv]'); if (b) { e.stopPropagation(); setOrderStatus(el.dataset.cid, el.dataset.oid, b.dataset.mv); } else openCustomer(el.dataset.cid); }; });
  } else {
    $('#ordList').innerHTML = rows.length ? `<div class="ord-rows">${rows.map(({ c, o }) => `<div class="ord-row" data-cid="${esc(c.id)}" data-oid="${esc(o.id)}"><div class="ord-main"><b>${esc(c.name)}</b> <small class="muted">${esc(c.phone || '')}</small><br><small>${esc(o.id)} · ${esc(o.product)} · ${dShort(o.date)}</small><br><small class="muted">${peso(orderNet(o))} · ${o.payment?.paid ? '✅ paid' + (o.payment.method ? ' (' + esc(o.payment.method) + ')' : '') : 'unpaid'} · since ${fmtDate(statusSince(o))}</small></div>
      <select class="st-sel st-${ordStatus(o)}">${STATUSES.map(([k, n]) => `<option value="${k}" ${k === ordStatus(o) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`).join('')}</div>` : '<p class="muted center">No orders match.</p>';
    $$('#ordList .ord-row').forEach(el => { el.querySelector('select').onchange = e => setOrderStatus(el.dataset.cid, el.dataset.oid, e.target.value); el.querySelector('.ord-main').onclick = () => openCustomer(el.dataset.cid); });
  }
}
async function setOrderStatus(cid, oid, st) {
  const list = crmAll(), c = list.find(x => x.id === cid), o = c?.orders?.find(x => x.id === oid); if (!o || ordStatus(o) === st) return;
  const at = new Date().toISOString();
  o.statusHistory = [...ordHist(o), { status: st, at, by: staffName() || (cloudOn() ? Cloud.profile?.email : null) || 'staff' }]; o.status = st; o.statusAt = at;
  crmSave(list);
  if (cloudOn()) cloudJob('status', () => updateOrderStatusCloud(oid, st).then(r => { if (r) { o.statusHistory = r.status_history; o.statusAt = r.status_updated_at; } }));
  toast(`${oid} → ${stLabel(st)}`); renderCRM();
  if (!$('#sheet').classList.contains('hidden') && $('#sheet').dataset.cid === cid) openCustomer(cid);
}
function renderReminders(list) {
  const due = replacementDue(list), late = readyOverdue(list);
  const tel = c => c.phone ? `<a class="btn ghost" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">📞 Call</a><a class="btn ghost" href="sms:${esc(c.phone.replace(/[^\d+]/g, ''))}">💬 SMS</a>` : '<span class="tiny muted">no phone</span>';
  $('#remList').innerHTML = `<div class="card"><h3>📦 Ready but not picked up (&gt; 3 days) <span class="tag">${late.length}</span></h3>${late.length ? late.map(({ c, o }) => `<div class="rem-row" data-cid="${esc(c.id)}"><div class="rem-main"><b>${esc(c.name)}</b> <small class="muted">${esc(c.phone || '')}</small><br><small>${esc(o.id)} · ${esc(o.product)} · ready since ${dShort(statusSince(o))} (<b>${Math.floor(daysAgo(statusSince(o)))} days</b>)</small></div><div class="rem-act">${tel(c)}<button class="btn primary" data-pick="${esc(o.id)}">Delivered ✓</button></div></div>`).join('') : '<p class="muted small">Nothing waiting – all ready orders were collected within 3 days.</p>'}</div>
    <div class="card"><h3>🔁 Replacement due (last order 6–12 months ago) <span class="tag">${due.length}</span></h3><p class="tiny muted">Insoles usually need replacing after 6–12 months of daily use.</p>${due.length ? due.map(({ c, o, age }) => `<div class="rem-row" data-cid="${esc(c.id)}"><div class="rem-main"><b>${esc(c.name)}</b> <small class="muted">${esc(c.phone || '')}</small><br><small>last: ${esc(o.product)} · ${dShort(o.date)} (${Math.round(age / 30.4)} months ago)</small></div><div class="rem-act">${tel(c)}<button class="btn primary" data-re="1">↻ Reorder</button></div></div>`).join('') : '<p class="muted small">No customers in the 6–12 month window.</p>'}</div>`;
  $$('#remList .rem-row').forEach(el => { el.querySelector('.rem-main').onclick = () => openCustomer(el.dataset.cid); });
  $$('#remList [data-pick]').forEach(b => b.onclick = () => setOrderStatus(b.closest('.rem-row').dataset.cid, b.dataset.pick, 'delivered'));
  $$('#remList [data-re]').forEach(b => b.onclick = () => openReorder(b.closest('.rem-row').dataset.cid));
}
function reportData(list, F) {
  const all = allOrders(list).filter(({ c, o }) => orderMatch(c, o, { ...F, status: '' }));
  const excluded = all.filter(({ c, o }) => ordStatus(o) === 'cancelled' || isTestOrder(c, o));
  const real = all.filter(x => !excluded.includes(x));
  const group = (keyFn) => { const m = new Map(); for (const { o } of real) { const k = keyFn(o); const g = m.get(k) || { k, n: 0, rev: 0 }; g.n++; g.rev += orderNet(o); m.set(k, g); } return [...m.values()]; };
  const byDay = group(o => dayKey(o.date)).sort((a, b) => b.k.localeCompare(a.k));
  const byMonth = group(o => dayKey(o.date).slice(0, 7)).sort((a, b) => b.k.localeCompare(a.k));
  const top = group(o => R.PRODUCTS.find(p => p.id === o.productId)?.name || o.product || '–').sort((a, b) => b.n - a.n || b.rev - a.rev);
  const paid = real.filter(({ o }) => o.payment?.paid);
  const byPay = (() => { const m = new Map(); for (const { o } of paid) { const k = o.payment.method || 'Not specified'; const g = m.get(k) || { k, n: 0, rev: 0 }; g.n++; g.rev += orderNet(o); m.set(k, g); } return [...m.values()].sort((a, b) => b.rev - a.rev); })();
  const unpaid = real.filter(({ o }) => !o.payment?.paid);
  return { real, excluded, byDay, byMonth, top, byPay, revenue: real.reduce((s, { o }) => s + orderNet(o), 0), collected: paid.reduce((s, { o }) => s + orderNet(o), 0), outstanding: unpaid.reduce((s, { o }) => s + orderNet(o), 0), unpaidN: unpaid.length };
}
function renderReports(list, F) {
  const d = reportData(list, F);
  const bars = (rows, label = r => esc(r.k)) => { const mx = Math.max(1, ...rows.map(r => r.rev)); return rows.length ? `<div class="rep-bars">${rows.map(r => `<div class="rep-bar"><span class="rep-l">${label(r)}</span><span class="rep-track"><i style="width:${Math.max(2, r.rev / mx * 100).toFixed(1)}%"></i></span><span class="rep-v">${peso(r.rev)}<small> · ${r.n}</small></span></div>`).join('')}</div>` : '<p class="muted small">No orders yet.</p>'; };
  const dayL = r => esc(new Date(r.k + 'T12:00:00+08:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }));
  const monL = r => esc(new Date(r.k + '-15T12:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }));
  $('#repBody').innerHTML = `<div class="rep-kpis"><div><b>${peso(d.revenue)}</b><span>Revenue</span></div><div><b>${d.real.length}</b><span>Orders</span></div><div><b>${peso(d.real.length ? Math.round(d.revenue / d.real.length) : 0)}</b><span>Average order</span></div><div><b>${peso(d.outstanding)}</b><span>Unpaid (${d.unpaidN})</span></div></div>
    <p class="tiny muted">Real orders only: excludes cancelled orders and test / sample-scan orders (${d.excluded.length} excluded). Revenue = price − discount. Dates in Philippine time. Filters above apply.</p>
    <div class="card"><h3>Sales by day</h3>${bars(d.byDay.slice(0, 31), dayL)}</div>
    <div class="card"><h3>Sales by month</h3>${bars(d.byMonth.slice(0, 12), monL)}</div>
    <div class="card"><h3>Top products</h3>${bars(d.top)}</div>
    <div class="card"><h3>Revenue by payment method</h3><p class="tiny muted">Paid orders: ${peso(d.collected)} collected.</p>${bars(d.byPay)}${d.unpaidN ? `<p class="small">Not yet paid: <b>${peso(d.outstanding)}</b> (${d.unpaidN} order(s))</p>` : ''}</div>`;
}
/* ---- export (CSV + xlsx) ---- */
function exportRows(list, F) {
  const custs = list.filter(c => custMatch(c, F)), ords = allOrders(list).filter(({ c, o }) => orderMatch(c, o, F));
  const ch = ['Customer ID', 'Name', 'Phone', 'Email', 'Tags', 'Staff notes', 'Customer since', 'Updated', 'Orders', 'Last order', 'Total spent (PHP)', 'Right foot (mm)', 'Left foot (mm)', 'Scan source', 'Test/sample'];
  const cr = custs.map(c => { const os = (c.orders || []).filter(o => ordStatus(o) !== 'cancelled'); const last = (c.orders || [])[0];
    return [String(c.id), c.name || '', c.phone || '', c.email || '', (c.tags || []).join(', '), c.notes || '', c.createdAt ? dayKey(c.createdAt) : '', c.updatedAt ? dayKey(c.updatedAt) : '', (c.orders || []).length, last ? dayKey(last.date) : '', os.reduce((s, o) => s + orderNet(o), 0), c.feet?.R?.length || '', c.feet?.L?.length || '', [...new Set(Object.values(c.feet || {}).map(f => SRC_LABEL[f.source] || f.source))].join(', '), isTestCust(c) ? 'yes' : '']; });
  const oh = ['Order no', 'Date (PHT)', 'Time (PHT)', 'Customer', 'Phone', 'Product', 'Colours', 'Initials', 'Size', 'Feet', 'Status', 'Status since (PHT)', 'Price (PHP)', 'Discount (PHP)', 'Net (PHP)', 'Payment method', 'Paid', 'Staff', 'Payment notes', 'Created by', 'Test/sample'];
  const tm = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
  const or = ords.map(({ c, o }) => [o.id, dayKey(o.date), tm(o.date), c.name || '', c.phone || '', o.product || '', o.design?.colors ? [o.design.colors.extruder1?.name, o.design.colors.extruder2?.name].filter(Boolean).join(' / ') : '', o.design?.text || '', o.size || '', (o.sides || []).join('+'), stLabel(ordStatus(o)), dayKey(statusSince(o)) + ' ' + tm(statusSince(o)), +o.total || 0, +o.payment?.discount || 0, orderNet(o), o.payment?.method || '', o.payment?.paid ? 'yes' : 'no', o.payment?.staffName || '', o.payment?.notes || '', o.by || '', isTestOrder(c, o) ? 'yes' : '']);
  return { ch, cr, oh, or };
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (h, rows) => '\ufeff' + [h, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function sheetXml(h, rows) {
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  const cell = (v, r, i, hdr) => typeof v === 'number' && isFinite(v) ? `<c r="${col(i)}${r}"><v>${v}</v></c>` : `<c r="${col(i)}${r}" t="inlineStr"${hdr ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${h.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(10, x.length + 4))}" customWidth="1"/>`).join('')}</cols><sheetData>${[h, ...rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, i) => cell(v, ri + 1, i, ri === 0)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
function buildXlsx(sheets) { // [{ name, h, rows }] -> Uint8Array
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const st = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipStore([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'xl/workbook.xml', data: wb }, { name: 'xl/_rels/workbook.xml.rels', data: wbr }, { name: 'xl/styles.xml', data: st }, ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.h, s.rows) }))]);
}
const expStamp = () => dayKey(new Date().toISOString());
$('#expCustCsv').onclick = () => { const x = exportRows(crmAll(), crmFilters()); download(`fixifoot-customers-${expStamp()}.csv`, toCsv(x.ch, x.cr), 'text/csv;charset=utf-8'); toast(`${x.cr.length} customer(s) exported`); };
$('#expOrdCsv').onclick = () => { const x = exportRows(crmAll(), crmFilters()); download(`fixifoot-orders-${expStamp()}.csv`, toCsv(x.oh, x.or), 'text/csv;charset=utf-8'); toast(`${x.or.length} order(s) exported`); };
$('#expXlsx').onclick = () => { const x = exportRows(crmAll(), crmFilters()); download(`fixifoot-crm-${expStamp()}.xlsx`, buildXlsx([{ name: 'Customers', h: x.ch, rows: x.cr }, { name: 'Orders', h: x.oh, rows: x.or }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Excel workbook exported'); };
/* ---- customer card ---- */
function scanHistoryOf(c) {
  const h = (c.scanHistory || []).slice();
  for (const sd of ['R', 'L']) { const f = c.feet?.[sd]; if (f && !h.some(x => x.side === sd && ((x.sig && x.sig === scanSig(f)) || (x.meshPath && x.meshPath === f.meshPath) || (x.length === f.length && x.source === f.source && (x.file || '') === (f.file || ''))))) h.push({ side: sd, ...f, date: c.updatedAt || c.createdAt, current: true }); }
  return h.sort((a, b) => new Date(b.date) - new Date(a.date));
}
function saveCustomerMeta(c, msg = 'Saved') {
  const list = crmAll(), i = list.findIndex(x => x.id === c.id); c.updatedAt = new Date().toISOString(); if (i >= 0) list[i] = c; crmSave(list);
  if (cloudOn()) cloudJob('save', () => saveCustomerCloud(c)); toast(msg);
}
function openCustomer(id) {
  const c = crmAll().find(x => x.id === id); if (!c) return;
  c.tags = c.tags || [];
  const probs = problemNames(c), s = c.settings || {}, pf = s.perFoot && Object.keys(s.perFoot).length ? s.perFoot : probs.perFoot;
  const tags = [...new Set([...TAG_PRESETS, ...c.tags])], hist = scanHistoryOf(c);
  sheet(`<div class="row-between"><h3 style="margin:0">${esc(c.name)}</h3><span class="tag" title="${esc(c.id)}">${esc(String(c.id).length > 12 ? String(c.id).slice(0, 8) : c.id)}</span></div>
    <p class="muted small" style="margin:4px 0 6px">Customer since ${fmtDate(c.createdAt)}${c.phone ? ` · <a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(c.phone)}</a>` : ''}</p>
    <div class="tagrow cc-tags">${tags.map(t => `<button class="ctag ctag-${esc(t.toLowerCase())} ${c.tags.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${c.tags.includes(t) ? '✓ ' : '+ '}${esc(t)}</button>`).join('')}<span class="cc-addtag"><input id="ccTagIn" placeholder="Custom tag" maxlength="24"><button class="btn ghost" id="ccTagAdd">Add</button></span></div>
    <details class="cc-sec"><summary><b>Details</b> <span class="muted small">${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''}</span></summary>
      <label class="field">Name<input id="ccName" value="${esc(c.name || '')}"></label><label class="field">Mobile<input id="ccPhone" inputmode="tel" value="${esc(c.phone || '')}"></label><label class="field">Email<input id="ccEmail" type="email" value="${esc(c.email || '')}"></label><button class="btn ghost" id="ccSaveDet">Save details</button></details>
    <h4 class="crm-h">Staff notes</h4><textarea id="ccNotes" rows="3" placeholder="Internal notes – not shown to the customer">${esc(c.notes || '')}</textarea><button class="btn ghost small-btn" id="ccSaveNotes">Save notes</button>
    <h4 class="crm-h">Orders (${(c.orders || []).length})</h4>${(c.orders || []).length ? `<div class="crm-orders">${c.orders.map(o => `<div class="cc-ord"><div class="row-between"><span><b>${esc(o.id)}</b><br><small class="muted">${fmtDate(o.date)} · ${esc(o.product)}${o.design?.text ? ' · “' + esc(o.design.text) + '”' : ''} · ${(o.sides || []).join('+')}${o.payment ? ' · ' + (o.payment.paid ? '✅ paid' : 'unpaid') + (o.payment.method ? ' (' + esc(o.payment.method) + ')' : '') : ''}</small></span><span class="crm-ord-r">${peso(orderNet(o))}<button class="btn ghost rc-open" data-oid="${esc(o.id)}">🧾 Receipt</button></span></div>
      <div class="cc-st"><select class="st-sel st-${ordStatus(o)}" data-oid="${esc(o.id)}">${STATUSES.map(([k, n]) => `<option value="${k}" ${k === ordStatus(o) ? 'selected' : ''}>${n}</option>`).join('')}</select><small class="muted cc-hist">${ordHist(o).map(h => `${stLabel(h.status)} ${new Date(h.at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`).join(' → ')}</small></div></div>`).join('')}</div>` : '<p class="muted small">No orders yet.</p>'}
    <div class="cc-reorder"><button class="btn primary big" id="crmReorder">↻ Same again</button><button class="btn ghost big" id="crmReorderChg">🎨 Change product / colours</button></div>
    <h4 class="crm-h">Scan history</h4>${hist.length ? `<div class="crm-orders">${hist.map((h, i) => `<div class="row-between"><span><b>${dShort(h.date)}</b> · ${sideName(h.side)} · ${h.length || '–'} × ${h.width || '–'} mm${h.archType ? ' · ' + esc(R.ARCH_TYPES[h.archType]?.short || h.archType) : ''}<br><small class="muted">${h.source === 'file' ? 'file ' + esc(h.file || '') : esc(SRC_LABEL[h.source] || h.source || '')}${h.meshPath ? ' · ☁️ raw scan stored' : ''}${h.current ? ' · current' : ''}</small></span><button class="btn ghost" data-v3d="${i}">View 3D</button></div>`).join('')}</div>` : '<p class="muted small">No scans saved.</p>'}
    <details class="cc-sec"><summary><b>Detected problems &amp; last settings</b></summary>
    <div class="zone-chips">${probs.length ? probs.map(n => `<span class="zchip">${esc(n)}</span>`).join('') : '<span class="muted small">none</span>'}</div>
    <table class="params">${Object.entries(pf).map(([sd, x]) => `<tr><td>${sideName(sd)}</td><td>${R.ARCH_TYPES[x.archType]?.short} · arch ${x.archHeight} mm · cup ${x.heelCupDepth} mm${x.medialPost ? ' · post ' + x.medialPost + '°' : ''}${x.lateralWedge ? ' · wedge ' + x.lateralWedge + '°' : ''}${x.heelLift ? ' · lift ' + x.heelLift + ' mm' : ''}${x.metPad ? ' · met pad' : ''} · ${x.shore}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">–</td></tr>'}
      <tr><td>Product</td><td>${esc(R.PRODUCTS.find(p => p.id === s.productId)?.name || '–')}${s.design ? ' · ' + esc(PAL(s.design.colors?.base).name) + ' / ' + esc(PAL(s.design.colors?.top).name) : ''}</td></tr></table></details>
    <div class="crm-actions"><button class="btn ghost" id="crmLoad">Open in dashboard</button><button class="btn ghost" id="crmDel"${cloudOn() && !Cloud.isAdmin ? ' disabled title="Admins only"' : ''}>Delete</button></div>
    <p class="tiny muted">Reorder regenerates the print files from the stored scan data and settings – no rescan needed.</p>`);
  $('#sheet').dataset.cid = c.id;
  $$('#sheet .rc-open').forEach(b => b.onclick = () => openReceipt(c.id, b.dataset.oid));
  $$('#sheet .cc-st select').forEach(sel => sel.onchange = () => setOrderStatus(c.id, sel.dataset.oid, sel.value));
  $$('#sheet [data-tag]').forEach(b => b.onclick = () => { const t = b.dataset.tag; c.tags = c.tags.includes(t) ? c.tags.filter(x => x !== t) : [...c.tags, t]; saveCustomerMeta(c, 'Tags updated'); openCustomer(c.id); });
  $('#ccTagAdd').onclick = () => { const t = $('#ccTagIn').value.trim().replace(/\s+/g, ' ').slice(0, 24); if (!t) return; const pre = TAG_PRESETS.find(p => p.toLowerCase() === t.toLowerCase()) || t; if (!c.tags.includes(pre)) c.tags = [...c.tags, pre]; saveCustomerMeta(c, 'Tag added'); openCustomer(c.id); };
  $('#ccSaveDet').onclick = () => { const n = $('#ccName').value.trim(); if (!n) { toast('Name is required'); return; } Object.assign(c, { name: n, phone: $('#ccPhone').value.trim(), email: $('#ccEmail').value.trim() }); saveCustomerMeta(c, 'Details saved'); openCustomer(c.id); renderCRM(); };
  $('#ccSaveNotes').onclick = () => { c.notes = $('#ccNotes').value.trim(); saveCustomerMeta(c, 'Notes saved'); };
  $$('#sheet [data-v3d]').forEach(b => b.onclick = () => viewScan3D(c, hist[+b.dataset.v3d]));
  $('#crmLoad').onclick = () => { loadCustomer(c); $('#sheet').classList.add('hidden'); show('s-staff'); toast(c.name + ' loaded'); };
  $('#crmReorder').onclick = () => doReorder(c, null);
  $('#crmReorderChg').onclick = () => openReorder(c.id);
  $('#crmDel').onclick = async () => {
    if (cloudOn() && !Cloud.isAdmin) { toast('Only an admin can delete customers'); return; }
    if (!confirm('Delete ' + c.name + (cloudOn() ? ' (cloud record, scans and STL files)?' : ' from this device?'))) return;
    if (cloudOn()) { try { await cloudQueue; await deleteCustomerCloud(c); } catch (e) { toast('Delete failed: ' + e.message, 4500); return; } }
    crmSave(crmAll().filter(x => x.id !== c.id)); if (state.customerId === c.id) state.customerId = null; $('#sheet').classList.add('hidden'); renderCRM(); };
}
let scanViewer = null, scanViewerEl = null;
async function viewScan3D(c, h) {
  if (!h) return;
  scanViewerEl ||= Object.assign(document.createElement('div'), { className: 'viewer scan3d', id: 'scanViewer' });
  sheet(`<div class="row-between"><h3 style="margin:0">${sideName(h.side)} foot · ${dShort(h.date)}</h3><button class="btn ghost small-btn" id="sv3Back">← Back</button></div><p class="small muted" id="sv3Note">Loading…</p><div id="sv3Host"></div><p class="tiny muted">${h.length || '–'} × ${h.width || '–'} mm${h.archType ? ' · ' + esc(R.ARCH_TYPES[h.archType]?.name || h.archType) : ''}${h.csi != null ? ' · CSI ' + h.csi + '%' : ''} · drag to rotate, pinch to zoom.</p>`);
  $('#sv3Host').appendChild(scanViewerEl); $('#sv3Back').onclick = () => openCustomer(c.id);
  scanViewer ||= new Viewer(scanViewerEl, { free: true }); scanViewer.resize(); if (scanViewer.shadow) scanViewer.shadow.visible = false;
  const illus = why => { scanViewer.set(buildFoot({ L: h.length || 250, W: h.width || 95, archType: h.archType || 'normal', side: h.side, peak: h.peakForefootPressure || 0.8 }), false); scanViewer.view('outside', false, h.side === 'L' ? 1 : -1); $('#sv3Note').textContent = 'Illustration from the saved measurements' + (why ? ' – ' + why : '') + '.'; };
  if (h.meshPath && cloudOn()) {
    try { const url = await signedUrl('scans', h.meshPath), buf = await (await fetch(url)).arrayBuffer(); const raw = objToGeo(new STLLoader().parse(buf)); const res = alignScan(raw, h.file || 'scan.stl'); scanViewer.set(heightColored(res.geo), false); $('#sv3Note').textContent = 'Original 3D scan from cloud storage (heat = contact zones).'; }
    catch (e) { console.warn(e); illus('the raw scan could not be loaded (' + e.message + ')'); }
  } else illus(h.source === 'file' ? 'the raw scan file is kept only in cloud storage' : h.source === 'manual' ? 'measured by hand, no 3D scan' : '');
}
function openReorder(cid) {
  const c = crmAll().find(x => x.id === cid); if (!c) return;
  const s = c.settings || {}, pid0 = s.design?.productId || s.productId || 'everyday', pid = R.DESIGN[pid0] ? pid0 : Object.keys(R.DESIGN)[0];
  const ds = { productId: pid, colors: { ...(s.design?.colors || { base: R.DESIGN[pid].def[0], top: R.DESIGN[pid].def[1] }) }, text: s.design?.text || '', size: s.design?.size || '' };
  const draw = () => {
    const d = R.DESIGN[ds.productId];
    sheet(`<div class="row-between"><h3 style="margin:0">↻ Reorder for ${esc(c.name)}</h3><button class="btn ghost small-btn" id="roBack">← Back</button></div><p class="small muted">Uses the saved scan – no rescan needed.</p>
      <label class="field">Product<select id="roProd">${Object.keys(R.DESIGN).map(id => `<option value="${id}" ${id === ds.productId ? 'selected' : ''}>${esc(R.PRODUCTS.find(p => p.id === id)?.name || id)} · ${peso(priceOf(id))}</option>`).join('')}</select></label>
      ${d.parts.map((part, i) => { const k = i ? 'top' : 'base'; return `<div class="ro-pal"><b class="small">${esc(part)}</b><div class="dz-sw">${R.PALETTE.map(pc => `<button class="sw ${pc.id === ds.colors[k] ? 'on' : ''}" data-k="${k}" data-c="${pc.id}" title="${esc(pc.name)}" style="background:${pc.hex}"></button>`).join('')}</div><small class="muted">${esc(PAL(ds.colors[k]).name)}</small></div>`; }).join('')}
      <label class="field">Initials (optional)<input id="roText" maxlength="${TEXT_RULES?.maxChars || 4}" value="${esc(ds.text)}" placeholder="e.g. JP"></label>
      <button class="btn primary big" id="roGo">Create order &amp; print files</button>`);
    $('#roBack').onclick = () => openCustomer(c.id);
    $('#roProd').onchange = e => { const nd = R.DESIGN[e.target.value]; ds.productId = e.target.value; ds.colors = { base: nd.def[0], top: nd.def[1] }; draw(); };
    $$('#sheet .ro-pal .sw').forEach(b => b.onclick = () => { ds.colors[b.dataset.k] = b.dataset.c; draw(); });
    $('#roText').oninput = e => { const v = cleanText(e.target.value); if (e.target.value.toUpperCase() !== v) e.target.value = v; ds.text = v; };
    $('#roGo').onclick = () => doReorder(c, ds);
  };
  draw();
}
async function doReorder(c, ds) {
  if (!Object.keys(c.feet || {}).length) { toast('This customer has no saved scan – take a new scan first', 4000); return; }
  $('#sheet').classList.add('hidden');
  loadCustomer(c);
  if (ds) { state.design = JSON.parse(JSON.stringify(ds)); applyDesign(); } else ensureProduct();
  if (designText() && !engraverReady()) { toast('Preparing initials…'); try { await loadEngraver(); } catch (e) { console.warn(e); } }
  const id = newOrderId(), stls = Object.keys(state.feet).map(sd => buildStl(sd, id));
  const spec = { ...buildSpec(id, stls.map(x => x.info)), customer: { id: c.id, name: c.name, phone: c.phone }, reorderFromSavedScan: true };
  download(`${id}-spec.json`, JSON.stringify(spec, null, 2), 'application/json');
  stls.forEach((x, i) => setTimeout(() => download(x.name, x.data, 'model/stl'), 400 * (i + 1)));
  recordOrder(id, 'reorder', spec, stls);
  toast(`Reorder ${id}: ${stls.length} print file(s) + spec created from the saved scan`, 4200);
  renderCRM(); openCustomer(c.id);
}
$('#crmSearch').oninput = renderCRM;
['#fTag', '#fProduct', '#fStatus', '#fFrom', '#fTo'].forEach(s => $(s).onchange = renderCRM);
$('#fClear').onclick = () => { ['#fTag', '#fProduct', '#fStatus', '#fFrom', '#fTo'].forEach(s => $(s).value = ''); renderCRM(); };
$$('#crmTabs button').forEach(b => b.onclick = () => { crmTab = b.dataset.t; renderCRM(); });
$$('#ordView button').forEach(b => b.onclick = () => { ordView = b.dataset.v; renderCRM(); });
window.__fixiCRM = { reportData: () => reportData(crmAll(), crmFilters()), exportRows: () => exportRows(crmAll(), crmFilters()), buildXlsx, toCsv, readyOverdue, replacementDue, setOrderStatus };
$('#crmBtn').onclick = () => show('s-crm');
$('#crmSaveBtn').onclick = () => {
  const cur = crmAll().find(x => x.id === state.customerId);
  sheet(`<h3>Save customer</h3><label class="field">Name<input id="svName" value="${esc(cur?.name || '')}" placeholder="Full name"></label><label class="field">Mobile<input id="svPhone" inputmode="tel" value="${esc(cur?.phone || '')}" placeholder="09xx xxx xxxx"></label><button class="btn primary big" id="svOk">Save scans + settings</button>`);
  $('#svOk').onclick = () => { const n = $('#svName').value.trim(); if (!n) return toast('Name required'); const c = saveCurrentCustomer(n, $('#svPhone').value.trim()); $('#sheet').classList.add('hidden'); toast('Saved: ' + c.name); renderStaff(); };
};
$('#crmNewBtn').onclick = () => { state.feet = {}; state.uploaded = {}; state.qa = {}; state.staffAdds = new Set(); state.staffRemoves = new Set(); state.archOverride = {}; state.customerId = null; state.product = null; show('s-scan'); };

/* ---------------- v9: design first – catalog -> designer -> summary -> scan ---------------- */
function renderCatalog() {
  $('#catalogGrid').innerHTML = R.CATALOG.map(id => R.PRODUCTS.find(p => p.id === id)).filter(Boolean).map(p => {
    const d = R.DESIGN[p.id], c = d.def.map(PAL);
    return `<button class="cat-card ${state.design?.productId === p.id ? 'on' : ''}" data-id="${p.id}"><img src="${p.image}" alt="${esc(p.name)}" loading="lazy">
      <div class="cat-body"><b>${esc(p.name.replace('Fixifoot ', ''))}</b><small>${esc(p.tagline || '')}</small>
      <div class="cat-meta"><span class="cat-sw">${c.map(x => `<i style="background:${x.hex}"></i>`).join('')}</span><span class="cat-price">${peso(priceOf(p.id))}</span></div></div></button>`; }).join('');
  $$('#catalogGrid .cat-card').forEach(b => b.onclick = () => { if (state.design?.productId !== b.dataset.id) startDesign(b.dataset.id); show('s-design'); });
}
let designViewer = null, dzTimer = null;
function renderDesignRows(el, onChange) {
  const dp = designParts();
  el.innerHTML = dp.map((d, i) => `<div class="dz-row"><div class="dz-lbl"><b>${esc(d.part)}</b> <span class="muted">· ${esc(d.name)}</span><span class="staff-only tiny muted"> · extruder ${d.extruder}</span></div>
    <div class="dz-sw">${R.PALETTE.map(c => `<button class="sw ${c.id === (i ? state.design.colors.top : state.design.colors.base) ? 'on' : ''}" data-k="${i ? 'top' : 'base'}" data-c="${c.id}" title="${esc(c.name)}" aria-label="${esc(d.part + ': ' + c.name)}" style="background:${c.hex}"></button>`).join('')}</div></div>`).join('');
  el.querySelectorAll('.sw').forEach(b => b.onclick = () => { state.design.colors[b.dataset.k] = b.dataset.c; applyDesign(); onChange(); });
}
function engravingNow() { const p = ensureProduct(); return p.dual ? (dualCache.R?.v?.engraving || dualCache.L?.v?.engraving || null) : (engDispCache.info || null); }
// close-up of the engraved heel: from above (or below for underside text), toes pointing up on screen so the initials read normally
function focusHeel(v, at) { const c = v.controls, below = at.where === 'bottom'; c.autoRotate = false; c.target.set(at.x, below ? 0 : 4, at.z); v.camera.position.set(at.x, below ? -165 : 175, at.z + (below ? 1 : -1) * at.dir * 100); c.update(); }
function renderDesign(keepView = true) {
  const ds = state.design; if (!ds) return; const p = ensureProduct(), d = R.DESIGN[p.id];
  $('#dzTitle').textContent = p.name; $('#dzTag').textContent = p.tagline || ''; $('#dzPrice').textContent = peso(priceOf(p.id));
  renderDesignRows($('#dzRows'), () => renderDesign(true));
  designViewer ||= new Viewer($('#designViewer'));
  const obj = productObject('R', currentSpec('R'), { zonesOn: false });
  designViewer.set(obj, keepView && !!designViewer.obj);
  const t = $('#dzText');
  { const e = engravingNow(), k = designText() + '|' + p.id; if (e?.at && !e.error && designViewer.focusKey !== k) { designViewer.focusKey = k; focusHeel(designViewer, e.at); } else if (!designText()) designViewer.focusKey = null; } if (document.activeElement !== t) t.value = ds.text || '';
  const txt = designText(), eg = engravingNow(), where = d.text === 'bottom' ? 'on the underside of the heel (keeps the top smooth for sensitive feet)' : (d.textU || 0) > .25 ? 'into the midfoot (between the cushions, so it never touches a pressure zone)' : 'into the heel';
  $('#dzTextNote').innerHTML = !txt ? `Up to ${TEXT_RULES.maxChars} letters or numbers, engraved ${where}.` : !engraverReady() || eg?.pending ? 'Preparing the engraving…'
    : eg?.error ? `⚠️ ${esc(/long/.test(eg.error) ? 'Too long to fit on the heel – try fewer letters.' : 'Engraving not possible on this model – we will add it as a note for our team.')}`
    : `✓ “${esc(txt)}” engraved ${where} – ${eg?.capHeightMm ?? TEXT_RULES.capMm} mm letters, ${TEXT_RULES.depthMm} mm deep${p.dual?.type === 'layer' && d.text === 'top' ? ', shown in your ' + esc(designParts()[0].name.toLowerCase()) + ' base colour' : ''}.`;
  $('#dzSize').innerHTML = `<option value="">My scan will measure it (recommended)</option>` + Array.from({ length: 13 }, (_, i) => 35 + i).map(eu => `<option value="${eu}" ${String(ds.size) === String(eu) ? 'selected' : ''}>EU ${eu} · US M ${eu - 33} / W ${eu - 31.5}</option>`).join('');
  $('#dzNext').textContent = `Continue – ${peso(priceOf(p.id))}`;
}
$('#dzText').oninput = e => { const v = cleanText(e.target.value); if (e.target.value.toUpperCase() !== v) e.target.value = v; state.design.text = v; clearTimeout(dzTimer); dzTimer = setTimeout(() => { if (!engraverReady()) loadEngraver().then(() => renderDesign(true)); else renderDesign(true); }, 280); };
$('#dzSize').onchange = e => { state.design.size = e.target.value; state.sizeMode = e.target.value || 'scan'; renderDesign(true); };
$('#dzNext').onclick = () => { try { state.design.snapshot = designViewer?.renderer.domElement.toDataURL('image/jpeg', .85); } catch { } show('s-summary'); };
function designSummary() {
  const ds = state.design, p = ensureProduct(), dp = designParts(p), mats = p.dual ? p.dual.bodies.map(b => b.material) : p.kind === 'insole' ? ['TPU 90A', '–'] : ['TPU 95A (sole)', 'TPU 85A (' + (p.kind === 'slide' ? 'upper' : 'strap') + ')'];
  const eg = engravingNow(), txt = designText();
  return { productId: p.id, product: p.name, chosenBeforeScan: true, changedBy: ds.changedBy || 'customer', keptSuggestion: ds.keptSuggestion || null,
    colors: { extruder1: { part: dp[0].part, id: dp[0].id, name: dp[0].name, hex: dp[0].hex, material: mats[0] }, extruder2: { part: dp[1].part, id: dp[1].id, name: dp[1].name, hex: dp[1].hex, material: mats[1] } },
    text: txt || null, engraving: txt ? (eg && !eg.pending ? eg : { text: txt, note: 'engraving geometry is generated with the print files' }) : null,
    size: ds.size ? 'EU ' + ds.size + ' (chosen)' : 'from scan', price: { currency: 'PHP', amount: priceOf(p.id) } };
}
function designDl() {
  const dp = designParts(), txt = designText(), sw = c => `<span class="sw" style="background:${c.hex};width:16px;height:16px;display:inline-block;vertical-align:-3px"></span>`;
  return `<dl class="dz-dl"><dt>${esc(dp[0].part)}</dt><dd>${sw(dp[0])} ${esc(dp[0].name)}</dd><dt>${esc(dp[1].part)}</dt><dd>${sw(dp[1])} ${esc(dp[1].name)}</dd><dt>Initials</dt><dd>${txt ? '“' + esc(txt) + '” engraved on the heel' : '–'}</dd></dl>`;
}
function renderSummary() {
  if (!state.design) return show('s-catalog', false); applyDesign();
  const p = ensureProduct(), ds = state.design;
  $('#designSummaryCard').innerHTML = `${ds.snapshot ? `<img class="ds-img" src="${ds.snapshot}" alt="Your design">` : `<img class="ds-img" src="${p.image}" alt="">`}
    <div class="row-between" style="margin:8px 0 4px"><b>${esc(p.name)}</b><span class="tag">${ds.size ? 'EU ' + esc(ds.size) : 'Size from scan'}</span></div>${designDl()}`;
  $('#dsPrice').textContent = peso(priceOf(p.id));
  const has = Object.keys(state.feet).length > 0; $('#dsScan').textContent = has ? 'Continue with my scan →' : 'Next: scan my feet 👣';
}
$('#dsScan').onclick = () => { if (Object.keys(state.feet).length) show(state.qa && Object.keys(state.qa).length ? 's-result' : 's-preview'); else show('s-scan'); };
// gentle suggestion: the rule engine may know a better model, but the customer's choice stays unless they (or staff) switch
function renderSuggestion(p) {
  const el = $('#designSuggest'); if (!el) return;
  const rec = recommendNow(), strong = rec.id !== 'everyday' || /Ball-of-foot/.test(rec.why);
  if (!state.design || rec.id === p.id || !strong || state.design.keptSuggestion === rec.id) { el.innerHTML = ''; return; }
  const rp = R.PRODUCTS.find(x => x.id === rec.id);
  el.innerHTML = `<div class="alert info suggest"><b>💡 A tip from your results</b><p>${esc(rp.name)} may suit you even better – ${esc(rec.why.charAt(0).toLowerCase() + rec.why.slice(1))}. Your choice stays as it is unless you change it.</p>
    <div class="crm-actions"><button class="btn ghost" id="sgSwitch">Switch to ${esc(rp.name.replace('Fixifoot ', ''))} (keep my colours)</button><button class="btn ghost" id="sgKeep">Keep ${esc(p.name.replace('Fixifoot ', ''))}</button></div></div>`;
  $('#sgSwitch').onclick = () => { state.design.productId = rp.id; state.design.switchedFrom = p.id; applyDesign(); toast('Switched to ' + rp.name); renderResult(false); };
  $('#sgKeep').onclick = () => { state.design.keptSuggestion = rec.id; renderResult(); };
}
// staff: design card + per-product prices (device setting; config.js window.FIXI_PRICES = { default: 9999, sport: 9999, … } for all devices)
function renderStaffDesign() {
  const el = $('#staffDesign'); if (!el) return;
  if (!state.design) { el.innerHTML = '<p class="tiny muted">Scan-first order (no design chosen before the scan). Colours from the product settings.</p><button class="btn ghost" id="sdStart">Start a design for this customer</button>'; $('#sdStart').onclick = () => { startDesign(ensureProduct().id); show('s-design'); }; }
  else { const d = designSummary(), eg = engravingNow();
    el.innerHTML = `<table class="params"><tr><td>Product</td><td>${esc(d.product)} · chosen by ${esc(d.changedBy)}${d.keptSuggestion ? ' · kept over suggested ' + esc(d.keptSuggestion) : ''}</td></tr>
      ${['extruder1', 'extruder2'].map((k, i) => `<tr><td>Extruder ${i + 1}</td><td><span class="sw" style="background:${d.colors[k].hex};width:14px;height:14px;display:inline-block;vertical-align:middle"></span> ${esc(d.colors[k].part)} – ${esc(d.colors[k].name)} ${esc(d.colors[k].hex)} · ${esc(d.colors[k].material)}</td></tr>`).join('')}
      <tr><td>Initials</td><td>${d.text ? `“${esc(d.text)}” – ${eg && !eg.error && !eg.pending ? `REAL geometry, ${esc(eg.location)}, ${eg.capHeightMm} mm letters, ${eg.depthMm} mm deep, min feature ${eg.minFeatureMm} mm (${esc(eg.method)})` : eg?.error ? '⚠️ ' + esc(eg.error) + ' – add by hand / note in spec' : 'generated with the print files'}` : '–'}</td></tr>
      <tr><td>Size</td><td>${esc(d.size)}</td></tr><tr><td>Price</td><td>${peso(d.price.amount)}</td></tr></table><button class="btn ghost" id="sdEdit">✏️ Edit design</button>`;
    $('#sdEdit').onclick = () => show('s-design'); }
  const pe = $('#priceEdit'); if (!pe) return;
  pe.innerHTML = R.CATALOG.map(id => R.PRODUCTS.find(p => p.id === id)).map(p => `<label class="price-row"><span>${esc(p.name.replace('Fixifoot ', ''))}</span><input type="number" min="0" step="1" inputmode="numeric" data-id="${p.id}" value="${priceOf(p.id)}"></label>`).join('');
}
$('#priceSave') && ($('#priceSave').onclick = () => { const o = {}; $$('#priceEdit input').forEach(i => { const v = Math.round(+i.value); if (v > 0) o[i.dataset.id] = v; }); try { localStorage.setItem(PRICE_KEY, JSON.stringify(o)); } catch { } toast('Prices saved on this device'); renderStaffDesign(); });
$('#priceReset') && ($('#priceReset').onclick = () => { localStorage.removeItem(PRICE_KEY); toast('Prices reset to ' + peso(window.FIXI_PRICES?.default ?? R.DEFAULT_PRICE)); renderStaffDesign(); });

/* ---------------- v10: staff settings, payment + PDF receipt ---------------- */
const staffName = () => (localStorage.getItem('fxStaffName') || Cloud.profile?.name || Cloud.profile?.email || '').trim();
function syncTestMode() { $$('.staff-test').forEach(e => e.classList.toggle('hidden', !(state.staff && testMode()))); }
function renderSettings() {
  const b = bizSettings(); [['bizName', 'name'], ['bizAddress', 'address'], ['bizTin', 'tin'], ['bizPhone', 'phone'], ['bizEmail', 'email']].forEach(([id, k]) => { if (document.activeElement !== $('#' + id)) $('#' + id).value = b[k]; });
  $('#bizState').textContent = bizConfigured(b) ? '· configured (PDF title “Receipt”)' : '· not set (PDF title “Acknowledgement Receipt”)';
  if (document.activeElement !== $('#staffNameIn')) $('#staffNameIn').value = staffName();
  $('#testModeChk').checked = testMode();
  $('#offlineNote').textContent = !Cloud.configured ? 'Offline mode: cloud sync is not set up – data stays on this device (shop PIN).' : cloudOn() ? `☁️ Cloud connected · signed in as ${Cloud.profile.email}.` : '⚠️ Cloud unreachable – working offline with the shop PIN. Upload on-device customers from Customers when the cloud is back.';
}
$('#bizSave').onclick = () => { saveBizSettings({ name: $('#bizName').value.trim(), address: $('#bizAddress').value.trim(), tin: $('#bizTin').value.trim(), phone: $('#bizPhone').value.trim(), email: $('#bizEmail').value.trim() }); toast('Business details saved on this device'); renderSettings(); };
$('#staffNameIn').onchange = e => { localStorage.setItem('fxStaffName', e.target.value.trim()); toast('Staff name saved'); };
$('#testModeChk').onchange = e => { localStorage.setItem('fxStaffTest', e.target.checked ? '1' : '0'); syncTestMode(); toast(e.target.checked ? '🧪 Test tools on (staff only)' : 'Test tools off'); };
function logoData() { try { const im = $('.brand-logo'), c = document.createElement('canvas'); c.width = im.naturalWidth || 640; c.height = im.naturalHeight || 184; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return { logo: c.toDataURL('image/png'), logoAspect: c.width / c.height }; } catch { return {}; } }
function receiptData(c, o) {
  const d = o.design, fi = o.feetInfo || Object.fromEntries(Object.entries(c.feet || {}).map(([s, f]) => [s, { length: f.length, source: f.source }])), pay = o.payment || {};
  const lines = [];
  if (d?.colors) lines.push(`Colours: ${d.colors.extruder1.part} – ${d.colors.extruder1.name}; ${d.colors.extruder2.part} – ${d.colors.extruder2.name}`);
  else if (o.color) { const pc = R.PALETTE.find(x => x.hex.toLowerCase() === String(o.color).toLowerCase()); lines.push('Colour: ' + (pc ? pc.name : o.color)); }
  lines.push('Initials: ' + (d?.text ? `“${d.text}” (engraved)` : 'none'));
  const fl = ['R', 'L'].filter(s => fi[s]).map(s => `${sideName(s)} ${fi[s].length} mm`).join(' · ');
  const srcs = [...new Set(Object.values(fi).map(f => f.source))];
  lines.push(`Size: ${o.size || (fi.R || fi.L ? 'EU ' + sizeFromLength(Math.max(...Object.values(fi).map(f => f.length))).eu : '–')}${fl ? ' · foot length ' + fl : ''}`);
  lines.push(srcs.every(x => x === 'file') ? 'Custom-made from your 3D foot scan' : srcs.includes('manual') ? 'Custom-made from manual foot measurements' : 'Made to your measurements');
  const test = /\bTEST\b/i.test(c.name || '') || srcs.some(x => x === 'sample' || x === 'demo');
  return { receiptNo: pay.receiptNo || o.id, date: o.date, customer: { name: c.name, phone: c.phone, email: c.email }, items: [{ title: o.product + ' (pair)', lines, qty: '1 pair', unit: o.total, n: 1 }],
    discount: pay.discount || 0, payment: { method: pay.method, paid: !!pay.paid }, staffName: pay.staffName || staffName(), notes: pay.notes || '', biz: bizSettings(), test, ...logoData() };
}
async function receiptAction(kind, c, o) {
  try { toast('Preparing receipt…', 1200); const r = await buildReceiptPdf(receiptData(c, o));
    if (kind === 'share') { const how = await shareBlob(r.blob, r.name, 'Fixifoot receipt ' + o.id); if (how === 'downloaded') toast('Sharing not available here – PDF downloaded'); }
    else if (kind === 'print') printBlob(r.blob); else { downloadBlob(r.blob, r.name); toast('Receipt downloaded'); }
    return r;
  } catch (e) { console.warn(e); toast('Could not create the receipt: ' + e.message, 4000); }
}
window.__fixiReceipt = { receiptData, buildReceiptPdf, bizSettings };
function saveOrderPayment(cid, oid, pay) {
  const list = crmAll(), c = list.find(x => x.id === cid), o = c?.orders?.find(x => x.id === oid); if (!o) return null;
  o.payment = { ...(o.payment || {}), ...pay, receiptNo: o.payment?.receiptNo || o.id }; crmSave(list);
  if (cloudOn()) cloudJob('payment', () => updateOrderPaymentCloud(o.id, o.payment));
  return { c, o };
}
function openReceipt(cid, oid) {
  const c = crmAll().find(x => x.id === cid), o = c?.orders?.find(x => x.id === oid); if (!o) return;
  const pay = o.payment || {}, sub = o.total;
  sheet(`<h3>🧾 Receipt ${esc(o.id)}</h3><p class="muted small">${esc(c.name)} · ${esc(o.product)} · ${fmtDate(o.date)}</p>
    <label class="field">Payment method<select id="rcMethod"><option value="">Not yet chosen</option>${PAY_METHODS.map(m => `<option ${m === pay.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="switch"><input type="checkbox" id="rcPaid" ${pay.paid ? 'checked' : ''}> Paid</label>
    <label class="field">Discount (₱)<input id="rcDisc" type="number" min="0" step="1" inputmode="numeric" value="${pay.discount || ''}" placeholder="0"></label>
    <label class="field">Notes<input id="rcNotes" maxlength="200" value="${esc(pay.notes || '')}"></label>
    <label class="field">Staff<input id="rcStaff" value="${esc(pay.staffName || staffName())}"></label>
    <div class="row-between rc-total"><span>Total</span><b id="rcTotal">${peso(sub - (pay.discount || 0))}</b></div>
    <button class="btn ghost big" id="rcSave">💾 Save payment</button>
    <div class="rc-btns"><button class="btn primary" data-rc="download">⬇ Download PDF</button><button class="btn ghost" data-rc="share">↗ Share</button><button class="btn ghost" data-rc="print">🖨 Print</button></div>
    <p class="tiny muted">${bizConfigured(bizSettings()) ? 'Titled “Receipt” with your business details.' : 'Titled “Acknowledgement Receipt” – add business name, address and TIN in Staff → Settings for a full receipt. Not an official BIR receipt.'}</p>`);
  const form = () => ({ method: $('#rcMethod').value || null, paid: $('#rcPaid').checked, discount: Math.min(sub, Math.max(0, Math.round(+$('#rcDisc').value || 0))), notes: $('#rcNotes').value.trim() || null, staffName: $('#rcStaff').value.trim() || null });
  $('#rcDisc').oninput = () => ($('#rcTotal').textContent = peso(sub - form().discount));
  $('#rcSave').onclick = () => { saveOrderPayment(cid, oid, form()); toast('Payment saved' + (cloudOn() ? ' (cloud)' : '')); };
  $$('#sheet [data-rc]').forEach(b => b.onclick = () => { const r = saveOrderPayment(cid, oid, form()); if (r) receiptAction(b.dataset.rc, r.c, r.o); });
}

/* ---------------- screen enter hooks ---------------- */
const onEnter = {
  's-catalog': renderCatalog,
  's-design': () => { if (!state.design) return show('s-catalog', false); applyDesign(); requestAnimationFrame(() => renderDesign(false)); if (!engraverReady()) loadEngraver().then(() => { if (designText() && $('#s-design').classList.contains('active')) renderDesign(true); }).catch(e => console.warn('engraver', e)); },
  's-summary': renderSummary,
  's-scan': () => { state.side = state.feet.R && !state.feet.L ? 'L' : 'R'; syncSideSeg(); },
  's-preview': () => { feetStatus(); requestAnimationFrame(renderFoot); },
  's-analysis': renderAnalysis,
  's-health': () => { recompute(); renderQuestionnaire(); renderConditions(); },
  's-products': () => { recompute(); renderProducts(); },
  's-result': () => { recompute(); state.highlight = null; requestAnimationFrame(() => renderResult(false)); },
  's-order': () => { recompute(); renderOrder(); },
  's-staff': () => { if (!state.staff) { askPin(); return; } renderStaff(false); },
  's-crm': () => { if (!state.staff) { askPin(); return; } enterCRM(); },
  's-align': () => { if (!state.staff) { askPin(); return; } requestAnimationFrame(() => renderAlign(false)); },
  's-fit': () => { if (!state.staff) { askPin(); return; } recompute(); requestAnimationFrame(() => renderFit(false)); }
};

// guard: steps after scan require a foot
const guard = id => SCREENS.indexOf(id) >= SCREENS.indexOf('s-preview') && !Object.keys(state.feet).length;
const _show = show;
window.fixiGo = id => _show(id); // debug helper
$$('[data-go]').forEach(b => b.addEventListener('click', e => { if (guard(b.dataset.go)) { e.stopImmediatePropagation(); toast('Please scan a foot first'); show('s-scan'); } }, true));
// demo shortcut: ?demo=flat jumps to a ready-made profile (useful for sales demos / screenshots)
const qp = new URLSearchParams(location.search);
const testHooks = !Cloud.configured || testMode(); // ?staff=1 / ?demo= only on offline/test devices, never for customers on the cloud app
if (qp.get('staff') === '1' && !Cloud.configured) state.staff = true;
document.body.classList.toggle('staff', state.staff);
if (qp.get('demo') && testHooks) {
  makeSampleFoot('R'); if (qp.get('both') === '1') makeSampleFoot('L'); const a = qp.get('demo'); if (R.ARCH_TYPES[a]) state.feet.R.archType = a;
  if (qp.get('cond')) qp.get('cond').split(',').forEach(id => state.staffAdds.add(id));
  recompute();
  if (qp.get('product')) { state.product = R.PRODUCTS.find(p => p.id === qp.get('product')); state.color = state.product?.colors[0]; state.strapColor = state.product?.strapColors?.[0]; }
}
window.__fixiFit = { alignScan, rasterizePlantar, deriveModel, buildContactSole, morphTemplate, toPrintable, fitCheck, buildFoot, STLLoader, OBJLoader, STLExporter, THREE, loadTemplate, templateCache, footModel, fitFor, buildStl, state, objToGeo };
seedCRM();
// v5 cloud init: no keys in config.js -> offline mode (PIN + on-device CRM); v10: PIN only when the cloud is unreachable
if (Cloud.configured) initCloud().then(() => {
  if (!Cloud.online) { if (state.staff) toast('Cloud unreachable – working offline on this device', 3500); }
  else if (sessionStorage.getItem('fxStaff') === '1' && Cloud.ready) setStaff(true);
  onCloudChange(() => { if (state.staff && Cloud.online && !Cloud.ready) setStaff(false); renderBanner(); });
  renderBanner();
});
show(qp.get('demo') && testHooks && qp.get('screen') ? qp.get('screen') : 's-welcome');
// branded splash
setTimeout(() => $('#splash')?.classList.add('gone'), qp.get('nosplash') ? 0 : 1100); setTimeout(() => $('#splash')?.remove(), qp.get('nosplash') ? 0 : 1700);
