// Fixifoot demo – UI / flow
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { TrackballControls } from 'three/addons/TrackballControls.js';
import { STLLoader } from 'three/addons/STLLoader.js';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { STLExporter } from 'three/addons/STLExporter.js';
import { buildFoot, buildProduct, buildPrintableSole, drawFootprint, adaptTemplate, wrapFoot, heatColor } from './geometry.js';
import { OPENING_PRESETS, HOLE_DIAMETERS } from './openings.js';
import { Cloud, initCloud, onCloudChange, signIn, signUp, signOut, resetPassword, fetchCustomers, saveCustomerCloud, insertOrderCloud, deleteCustomerCloud, listStaff, setRole } from './cloud.js';
import { alignScan, rasterizePlantar, deriveModel, encodeGrid, decodeGrid, buildContactSole, morphTemplate, toPrintable, fitCheck, colorByGap, drawFitMap, ALLOW } from './fit.js';

const R = window.FixiRules;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const SCREENS_ALL = ['s-crm'];
const SCREENS = ['s-welcome', 's-scan', 's-preview', 's-analysis', 's-health', 's-products', 's-result', 's-order'];
const peso = n => '₱' + n.toLocaleString('en-PH');

const state = {
  side: 'R', feet: {}, archOverride: {}, uploaded: {},
  answers: { diabetes: 'no', heelPain: 'no', jointPain: 'no', standing: '0-4', activity: 'moderate', weight: '60-90', lldMm: 5, lldSide: 'left' },
  conditions: new Set(), sources: {}, qa: {}, qIndex: 0, staffAdds: new Set(), staffRemoves: new Set(), staff: sessionStorage.getItem('fxStaff') === '1' && !(window.FIXI_CLOUD?.url && window.FIXI_CLOUD?.anonKey),
  sizeMode: 'scan', base: '', product: null, color: null, strapColor: null, integrate: true, showZones: true, highlight: null,
  history: ['s-welcome'], lastParams: null,
  look: { heat: true, wire: false, scan: false }, previewSide: 'both', totalContact: true, customerId: null, archFill: null, rawScans: {}, nudge: {}, alignSide: 'R', fitSide: 'R',
  openings: { on: true, density: 'med', d: 3.5 } // v6: real ventilation holes (perforated) / lattice (slide) in preview + STL
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
    const D = { iso: [[-0.55, 0.62, -1], [0, 1, 0]], top: [[0, 1, 0.0001], [0, 0, -1]], bottom: [[0, -1, 0.0001], [0, 0, -1]], inside: [[medialX, 0.08, 0], [0, 1, 0]], outside: [[-medialX, 0.08, 0], [0, 1, 0]], back: [[0, 0.12, 1], [0, 1, 0]], front: [[0, 0.12, -1], [0, 1, 0]] }[name] || [[-0.55, 0.62, -1], [0, 1, 0]];
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
  if (id !== 's-scan') stopCamera();
  onEnter[id]?.();
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
  const f = state.feet[side] || mainFoot();
  const footL = state.sizeMode === 'scan' ? f.length : lengthFromEU(+state.sizeMode);
  const footW = state.sizeMode === 'scan' ? f.width : Math.round(footL * f.width / f.length);
  const allow = state.product && state.product.kind !== 'insole' ? 12 : 6;
  return { footL, L: footL + allow, W: footW + 4, eu: sizeFromLength(footL).eu };
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function mainFoot() { return state.feet[state.side] || Object.values(state.feet)[0]; }
function longestFoot() { return Object.values(state.feet).reduce((a, b) => (!a || b.length > a.length ? b : a), null); }

/* ---------------- scan screen ---------------- */
let stream = null, scanning = false;
let scanUseCam = true;
function syncSideSeg() {
  $$('#scanSteps span').forEach(s => { s.classList.toggle('on', s.dataset.side === state.side); s.classList.toggle('done', state.side === 'L' && s.dataset.side === 'R'); });
  $('#scanBtn').textContent = `Start demo scan – ${sideName(state.side)} foot`;
  $('#skipCamBtn').textContent = `No camera? Run simulated scan (${sideName(state.side).toLowerCase()})`;
}
// after a foot is captured: right -> short "now your left foot" -> left scan starts automatically -> both feet preview
async function afterCapture(side) {
  const other = side === 'R' ? 'L' : 'R';
  if (!state.feet[other]) {
    if (!$('#s-scan').classList.contains('active')) show('s-scan');
    state.side = other; syncSideSeg(); resetRing(); window.scrollTo({ top: 0, behavior: 'smooth' });
    const tr = $('#scanTransition'); $('#trSide').textContent = sideName(other).toLowerCase(); tr.classList.remove('hidden');
    await new Promise(r => setTimeout(r, 1700)); tr.classList.add('hidden');
    if ($('#s-scan').classList.contains('active')) runScan(scanUseCam, true);
  } else { stopCamera(); resetRing(); state.side = 'R'; toast('Both feet captured 🎉'); show('s-preview'); }
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { $('#camMsg').textContent = 'Camera not available here (needs HTTPS or localhost) – simulated view.'; return false; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    const v = $('#camVideo'); v.srcObject = stream; await v.play().catch(() => {});
    $('#camFallback').classList.add('hidden-fb'); return true;
  } catch (e) { $('#camMsg').textContent = 'Camera permission denied – showing simulated view.'; return false; }
}
function stopCamera() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } $('#camFallback').classList.remove('hidden-fb'); }
const PHASES = [[0, 'Finding paper'], [12, 'Heel'], [30, 'Inner arch'], [48, 'Outer side'], [64, 'Toes'], [80, 'Building 3D mesh'], [95, 'Measuring']];
async function runScan(useCam, keepCam = false) {
  if (scanning) return; scanning = true; scanUseCam = useCam;
  if (useCam && !stream) await startCamera();
  const wrap = $('#camWrap'); wrap.classList.add('scanning');
  const line = document.createElement('div'); line.className = 'scanline'; wrap.appendChild(line);
  $('#scanHint').textContent = `Move slowly around your ${sideName(state.side).toLowerCase()} foot… (demo: capture is simulated)`; $('#camMsg').textContent = 'Demo camera view';
  const dur = 6200, t0 = performance.now(), C = 327;
  await new Promise(res => {
    const tick = () => {
      const pct = Math.min(100, (performance.now() - t0) / dur * 100);
      $('#ringFg').style.strokeDashoffset = C * (1 - pct / 100);
      $('#ringPct').textContent = Math.round(pct) + '%';
      $('#ringPhase').textContent = PHASES.filter(p => pct >= p[0]).pop()[1];
      pct < 100 ? requestAnimationFrame(tick) : res();
    }; tick();
  });
  line.remove(); wrap.classList.remove('scanning'); scanning = false;
  makeSimulatedScan(state.side);
  afterCapture(state.side);
}
function resetRing() { $('#ringFg').style.strokeDashoffset = 327; $('#ringPct').textContent = '0%'; $('#ringPhase').textContent = 'Ready'; $('#scanHint').textContent = 'Place the foot on a sheet of A4 paper. Hold the phone 30–40 cm away and slowly move it around the foot.'; }
function makeSimulatedScan(side) {
  const other = state.feet[side === 'L' ? 'R' : 'L'];
  const r = rng(Date.now() ^ (side === 'L' ? 77 : 11));
  let archType;
  if (other && other.source === 'demo' && r() < 0.5) archType = other.archType; // feet can differ
  else { const x = r(); archType = x < 0.15 ? 'high' : x < 0.5 ? 'normal' : x < 0.8 ? 'low' : 'flat'; }
  const L = other ? other.length + Math.round(r() * 6 - 3) : Math.round(232 + r() * 50);
  const csiRange = { high: [5, 19], normal: [22, 44], low: [46, 59], flat: [61, 78] }[archType];
  const ahi = { high: .37, normal: .34, low: .315, flat: .29 }[archType] + (r() - .5) * .012;
  state.feet[side] = {
    side, source: 'demo', archType, length: L, width: Math.round(L * (0.385 + r() * 0.03)),
    csi: Math.round(csiRange[0] + r() * (csiRange[1] - csiRange[0])), ahi: +ahi.toFixed(3), peakForefootPressure: +(0.6 + r() * 0.4).toFixed(2)
  };
  delete state.archOverride[side]; delete state.uploaded[side]; delete state.rawScans[side];
}
function archFromCSI(csi) { return csi < 20 ? 'high' : csi <= 45 ? 'normal' : csi <= 60 ? 'low' : 'flat'; }
$('#scanBtn').onclick = () => runScan(true);
$('#skipCamBtn').onclick = () => runScan(false);
// uploaded scans: auto-align (units, floor plane, heel/toe, left/right, trim ankle) -> 2 mm plantar map
function objToGeo(obj) {
  if (obj.isBufferGeometry) return obj;
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
    else throw new Error('Please choose an .stl or .obj file');
    const raw = objToGeo(obj);
    const res = alignScan(raw, f.name);
    const side = applyAligned(res, f.name, raw);
    state.nudge[side] = {};
    toast(`${f.name}: ${sideName(side)} foot detected · ${res.info.units} → mm · ${Math.round(res.model.L)} mm long`, 3600);
    if (state.staff) { state.alignSide = side; state.alignThen = true; show('s-align'); }
    else afterCapture(side);
  } catch (err) { console.error(err); toast('Could not read file: ' + err.message, 4000); }
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
  sides.forEach(s => { const o = footObject(s), f = state.feet[s]; if (sides.length > 1) o.position.x = (s === 'R' ? -1 : 1) * 68; g.add(o); labels.push({ text: sideName(s), pos: new THREE.Vector3(o.position.x, f.length * 0.5, 0) }); });
  footViewer.set(g, false);
  footViewer.setLabels(labels);
  footViewer.medialX = sides.length === 1 && sides[0] === 'L' ? 1 : -1;
  const anyFile = sides.some(s => state.uploaded[s]);
  $('#previewSource').textContent = (sides.length > 1 ? 'Both feet' : sideName(sides[0]) + ' foot') + (anyFile ? ' · from file' : ' · 3D scan (demo)');
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
    : `Demo values (simulated scan). Contact index (CSI) ${f.csi}%. Size ≈ EU ${sz.eu} / US M ${sz.usM} / US W ${sz.usW}.`;
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
$('#seeResultsBtn').onclick = () => { recompute(); toast('Great, thank you! 🙌'); show('s-products'); };
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
function renderProducts() {
  const f = longestFoot(), sz = f ? sizeFromLength(f.length) : null;
  $('#productList').innerHTML = R.PRODUCTS.map(p => `<div class="product ${state.product?.id === p.id ? 'on' : ''}" data-id="${p.id}">
    <img src="${p.image}" alt="${p.name}" loading="lazy"><div class="p-body"><b>${p.name}</b><p>${p.desc}</p>
    <div class="p-meta"><div class="swatches">${p.colors.map(c => `<span class="sw" style="background:${c}"></span>`).join('')}</div><span class="tag">${sz ? 'Size EU ' + sz.eu + ' (from scan)' : ''}</span></div></div></div>`).join('');
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
const thickFor = p => (p.id === 'perforated' ? 2.2 : p.id === 'fullcontact' ? 3.6 : undefined);
// one place that builds the product for display (zones) or for printing / fit check
const openingMode = p => p?.id === 'perforated' ? 'holes' : p?.id === 'slide' ? 'lattice' : null;
function openingsFor(p) { const m = openingMode(p); return m && state.openings.on ? { mode: m, density: state.openings.density, ...(m === 'holes' ? { d: state.openings.d || 3.5 } : {}) } : null; }
function productObject(side, spec, { display = true, zonesOn = state.showZones, openings = display } = {}) {
  const p = ensureProduct(), md = scanModel(side), useTpl = state.base && p.kind === 'insole' && templateCache[state.base];
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
    if (!display) { const s = buildContactSole(md, { params: { ...spec.params, _thick: thickFor(p) }, kind: p.kind, zones: [], showZones: false, color: state.color, lastLen, openings: op }); return s; }
    return buildProduct(p, { L: 0, W: 0, params: spec.params, side, ...z, color: state.color, strapColor: state.strapColor, integrate: true, openings: op, soleFn: o => buildContactSole(md, { ...o, lastLen }) });
  }
  const d = productDims(side);
  if (!display) return buildPrintableSole(p, { L: d.L, W: d.W, params: spec.params, side, integrate: integ, openings: op });
  return buildProduct(p, { L: d.L, W: d.W, params: spec.params, side, ...z, color: state.color, strapColor: state.strapColor, integrate: integ, openings: op });
}
// fit check: product top vs scanned plantar surface
const fitCache = {};
function fitFor(side) {
  const md = footModel(side); if (!md || !state.feet[side]) return null;
  const spec = currentSpec(side), key = JSON.stringify([state.product?.id, state.base, state.sizeMode, state.integrate, state.totalContact, spec.params, state.feet[side].mapId, md.L, archOf(side)]);
  if (fitCache[side]?.key === key) return fitCache[side].v;
  const obj = productObject(side, spec, { display: false, openings: false });
  const geo = obj.isMesh ? obj.geometry : null; let v = null;
  if (geo) { try { v = { md, spec, geo, fit: fitCheck(md, geo, spec.params), scanBased: !!scanModel(side) }; } catch (e) { console.warn('fit', e); } }
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
  const useTpl = state.base && p.kind === 'insole' && templateCache[state.base];
  $('#templateSel').disabled = p.kind !== 'insole';
  const obj = productObject(f.side, spec);
  productViewer.set(obj, keepView && !!productViewer.obj); $('#templateSel').value = p.kind === 'insole' ? state.base : '';
  // colours
  $('#colorRow').innerHTML = 'Colour ' + p.colors.map(c => `<span class="sw ${c === state.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('');
  $$('#colorRow .sw').forEach(s => s.onclick = () => { state.color = s.dataset.c; renderResult(); });
  $('#strapRow').classList.toggle('hidden', !p.strapColors);
  if (p.strapColors) { $('#strapRow').innerHTML = 'Strap ' + p.strapColors.map(c => `<span class="sw ${c === state.strapColor ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join(''); $$('#strapRow .sw').forEach(s => s.onclick = () => { state.strapColor = s.dataset.c; renderResult(); }); }
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
  const addons = [pp.metPad && 'Metatarsal pad', pp.heelLift && 'Heel lift', pp.mortonExtension && "Morton's extension", pp.lateralFlange && 'Lateral flange', pp.toeCrest && 'Toe crest', pp.sesamoidCutout && "Dancer's pad", pp.offloadPockets && 'Offloading pockets', pp.dualDensity && 'Dual density'].filter(Boolean);
  const lines = [[p.name + ' (pair)', p.examplePrice], ...addons.map(a => [a, R.ADDON_EXAMPLE_PRICE])];
  if (p.kind !== 'insole' && state.integrate) lines.push(['Custom footbed built into sole', 300]);
  return lines;
}
function renderOrder() {
  const cur = crmAll().find(x => x.id === state.customerId); if (cur) { $('#custName').value ||= cur.name; $('#custPhone').value ||= cur.phone || ''; }
  const p = state.product, f = mainFoot(), spec = currentSpec(), sz = sizeFromLength(productDims(longestFoot().side).footL), dims = productDims(f.side);
  const condNames = spec.conditions.map(id => R.CONDITIONS.find(c => c.id === id).name);
  $('#summaryCard').innerHTML = `<div class="row-between" style="margin-bottom:10px"><b>${p.name}</b><span class="sw" style="background:${state.color};width:28px;height:28px"></span></div>
    <dl><dt>Feet scanned</dt><dd>${Object.keys(state.feet).map(sideName).join(' + ')}</dd><dt>Size</dt><dd>EU ${sz.eu} · US M ${sz.usM} / W ${sz.usW}</dd><dt>Print outline</dt><dd>${dims.L} × ${dims.W} mm</dd>
    <dt>Arch type</dt><dd>${R.ARCH_TYPES[spec.archType].short}</dd><dt>Material</dt><dd>TPU ${spec.params.shore}${spec.params.dualDensity ? ' + soft top' : ''}</dd>
    <dt>Arch / heel cup</dt><dd>${spec.params.archHeight} / ${spec.params.heelCupDepth} mm</dd><dt>Posting</dt><dd>${spec.params.medialPost ? 'medial ' + spec.params.medialPost + '°' : spec.params.lateralWedge ? 'lateral ' + spec.params.lateralWedge + '°' : 'none'}</dd>
    <dt>Problems</dt><dd>${condNames.length ? condNames.join(', ') : 'none selected'}</dd></dl>
    ${spec.params.referClinician ? '<div class="alert warn">Recommend a podiatrist / doctor check before and after fitting.</div>' : ''}`;
  const lines = priceLines(spec), total = lines.reduce((s, l) => s + l[1], 0);
  $('#priceTotal').textContent = peso(total);
  $('#priceLines').innerHTML = lines.map(l => `<div class="row-between"><span>${l[0]}</span><span>${peso(l[1])}</span></div>`).join('') + '<p>Example prices for the demo only – not a quote.</p>';
}
function download(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
/* ---------------- production export (shared by order + staff dashboard) ---------------- */
const newOrderId = () => 'FXF-' + Date.now().toString(36).toUpperCase();
function ensureProduct() { if (!state.product) { state.product = R.PRODUCTS.find(x => x.id === 'fullcontact'); state.color = state.product.colors[0]; } return state.product; }
function buildStl(side, id) {
  const p = ensureProduct(), sp = currentSpec(side), md = scanModel(side);
  const useTpl = !!(state.base && p.kind === 'insole' && templateCache[state.base]);
  const name = `${id}-${p.id}-${p.kind === 'insole' ? 'insole' : 'sole'}-${sideName(side).toLowerCase()}.stl`;
  if (md && (useTpl || p.kind === 'insole' || state.integrate)) {
    // scan-accurate path: total-contact sole / morphed template, converted to Z-up, Z=0, outward normals
    const obj = productObject(side, sp, { display: false, openings: true }), A = obj.userData?.anchors;
    const pts = A && p.kind === 'flipflop' ? [A.post, A.endM, A.endL] : A && p.kind === 'slide' ? [A.endM, A.endL] : [];
    const pr = toPrintable(obj.geometry, pts), fv = fitFor(side);
    const info = { file: name, side: sideName(side), units: 'mm', zUp: true, restsOnZ0: true, flatBottomZ0: !useTpl, watertight: true,
      base: useTpl ? `template ${state.base} morphed to scan (piecewise u-warp heel/arch/ball/toe + width + Z conform)` : 'total-contact sole from 2 mm plantar map',
      totalContact: true, fromScan: true, archFillPct: sp.params.archFill ?? 100, ...pr.stats,
      allowanceMm: ALLOW[p.kind] || ALLOW.insole, lastLengthMm: lastLenFor(p.kind),
      landmarks: { footLengthMm: md.L, ballWidthMm: md.W, heelWidthMm: md.heelW, archApexPct: Math.round(md.archU * 100), archHeightMm: md.archH, ballLinePct: Math.round(md.ballU * 100), toeGapDetected: md.toeGap.detected },
      fit: fv ? { verdict: fv.fit.verdict, ...fv.fit.stats, placementTilt: fv.fit.tilt, modifiedZones: fv.fit.modStats.map(m => ({ name: m.name, meanGapMm: m.mean, areaCm2: m.areaCm2 })) } : null };
    if (obj.userData?.openings) info.openings = obj.userData.openings;
    if (pts.length) info.strapHolesMm = Object.fromEntries((p.kind === 'flipflop' ? ['toePost', 'medialStrap', 'lateralStrap'] : ['medialStrapEdge', 'lateralStrapEdge']).map((k, i) => [k, { x: +pr.points[i].x.toFixed(1), y: +pr.points[i].y.toFixed(1), zTop: +pr.points[i].z.toFixed(1) }]));
    return { name, info, data: new STLExporter().parse(new THREE.Mesh(pr.geometry), { binary: true }) };
  }
  const d = productDims(side);
  const solid = useTpl ? (() => { const g = templateGeo(side, sp, false); const m = new THREE.Mesh(g); m.userData.stats = { ...g.userData.stats }; return m; })()
    : buildPrintableSole(p, { L: d.L, W: d.W, params: sp.params, side, integrate: p.kind === 'insole' || state.integrate, openings: openingsFor(p) });
  const info = { file: name, side: sideName(side), totalContact: false, units: 'mm', zUp: true, restsOnZ0: true, flatBottomZ0: !useTpl, base: useTpl ? 'template ' + state.base + ' (uniform scale)' : 'parametric', fromScan: !!state.feet[side], ...solid.userData.stats, ...(solid.userData.openings ? { openings: solid.userData.openings } : {}) };
  return { name, info, data: new STLExporter().parse(solid, { binary: true }) };
}
function buildSpec(id, stlInfos = []) {
  const p = ensureProduct(), feet = Object.keys(state.feet);
  const perFoot = feet.map(s => { const sp = currentSpec(s); return { side: sideName(s), scan: { ...state.feet[s], map: state.feet[s].map ? `${state.feet[s].map.nx}×${state.feet[s].map.nz} plantar height map @ ${state.feet[s].map.res} mm (stored)` : null, plantar: undefined }, totalContact: !!sp.totalContact, archType: sp.archType, params: sp.params, clinicalRationale: R.rationale(sp, { totalContact: sp.totalContact, scanArchH: sp.scanArchH }).map(r => ({ title: r.title, value: r.value, why: r.why, sources: r.refs.map(x => x.url) })), zones: sp.zones.map(z => ({ id: z.id, label: z.label, reasons: z.reasons })), notes: sp.notes, conflicts: sp.conflicts }; });
  const spec = currentSpec(), lines = priceLines(spec);
  return { orderId: id, demo: true, brand: 'Fixifoot Philippines', createdAt: new Date().toISOString(), product: { id: p.id, name: p.name, color: state.color, strapColor: state.strapColor || null, footbedIntegrated: p.kind === 'insole' || state.integrate, base: state.base || 'parametric', openings: openingsFor(p) && !(state.base && p.kind === 'insole') ? { ...OPENING_PRESETS[openingsFor(p).mode][state.openings.density], ...openingsFor(p) } : null },
    size: sizeFromLength(longestFoot().length), questionnaire: state.answers, questionnaireRaw: state.qa, conditions: spec.conditions, feet: perFoot,
    examplePrice: { currency: 'PHP', lines, total: lines.reduce((s, l) => s + l[1], 0), note: 'example only' },
    print: { material: 'TPU ' + spec.params.shore, infill: spec.params.infill, walls: 3, nozzleTempC: '220-235', printer: 'e.g. Creality K1C (220×220 bed – place insole diagonally)', note: 'Demo spec – verify in slicer' },
    stlFiles: stlInfos,
    stlNotes: [p.kind === 'flipflop' ? 'STL = sole/footbed only. Strap and toe post are separate parts.' : p.kind === 'slide' ? 'STL = sole/footbed only. Lattice upper is a separate part.' : 'STL = full insole solid.',
      openingMode(p) && openingsFor(p) && !(state.base && p.kind === 'insole') ? (p.id === 'perforated' ? `Ventilation holes are REAL through-holes in the STL (Ø ${state.openings.d || 3.5} mm, ${OPENING_PRESETS.holes[state.openings.density].label}); heel cup, arch support and edge margin kept solid.` : `Lattice openings are REAL through-openings in the sole STL (${OPENING_PRESETS.lattice[state.openings.density].label}); solid rim and strap-anchor areas.`) : openingMode(p) ? (state.base && p.kind === 'insole' ? 'Template base selected: ventilation holes are not cut into template models – use the parametric / scan sole for real holes.' : 'Openings switched off by staff: solid sole.') : null, state.base ? 'Template-based STL keeps the curved bottom of the original Fixifoot model.' : 'Parametric STL has a flat bottom on Z=0.'].filter(Boolean),
    disclaimer: 'Comfort product, not a medical diagnosis. See a podiatrist for diabetes or pain.' };
}
$('#sendBtn').onclick = () => {
  const id = newOrderId(), stls = Object.keys(state.feet).map(s => buildStl(s, id)), spec = buildSpec(id, stls.map(s => s.info));
  download(`${id}-spec.json`, JSON.stringify(spec, null, 2), 'application/json');
  stls.forEach((s, i) => setTimeout(() => download(s.name, s.data, 'model/stl'), 500 * (i + 1)));
  toast(`Demo order ${id}: spec + ${stls.length} STL file(s) downloaded`, 4000);
  recordOrder(id, 'production', spec, stls);
};
$('#orderBtn').onclick = () => {
  const name = $('#custName').value.trim(), phone = $('#custPhone').value.trim();
  if (!name) { toast('Please enter your name'); $('#custName').focus(); return; }
  saveCurrentCustomer(name, phone); recordOrder(newOrderId(), 'customer');
  $('#thanks').classList.remove('hidden');
  const cf = $('#confetti'); cf.innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${['#0099ff', '#ffd22e', '#015ad8', '#5cc2ff', '#162327'][i % 5]};animation-delay:${Math.random() * 0.8}s"></i>`).join('');
};
$('#thanksDone').onclick = () => $('#thanks').classList.add('hidden');
$('#restartBtn').onclick = () => { location.reload(); };

/* ---------------- staff mode (PIN) + banner ---------------- */
const STAFF_PIN = '1234'; // demo PIN – change here
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
  state.staff = on; document.body.classList.toggle('staff', on); sessionStorage.setItem('fxStaff', on ? '1' : '0');
  if (on) { toast('Staff view on'); show('s-staff'); }
  else { toast('Customer view'); if ($('#s-staff').classList.contains('active')) { state.history = state.history.filter(h => h !== 's-staff'); show(state.history[state.history.length - 1] || 's-welcome', false); } else { const act = document.querySelector('.screen.active'); if (act && onEnter[act.id] && !['s-scan'].includes(act.id)) onEnter[act.id](); } }
  renderBanner();
}
function askPin() { if (Cloud.configured && Cloud.online && Cloud.client && navigator.onLine !== false) return askLogin(); return askPinLocal(); }
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
    try { const p = await signIn(email, pass); if (!Cloud.ready) { msg(p ? 'Account pending admin approval.' : 'No staff profile found.', true); return; } $('#sheet').classList.add('hidden'); setStaff(true); } catch (e) { msg(e.message, true); } };
  $('#lgIn').onclick = go; $('#lgPass').onkeydown = e => e.key === 'Enter' && go();
  $('#lgUp').onclick = async () => { const nm = $('#lgName'); if (nm.classList.contains('hidden')) { nm.classList.remove('hidden'); $('#lgUp').textContent = 'Create account now'; return msg('Enter email, a password (8+ chars) and your name'); }
    const { email, pass } = vals(); if (!email || pass.length < 8) return msg('Email and a password of 8+ characters needed', true);
    try { const r = await signUp(email, pass, nm.value.trim()); msg(r.needsConfirm ? 'Check your email to confirm, then ask an admin to approve you.' : 'Account created – waiting for admin approval.'); } catch (e) { msg(e.message, true); } };
  $('#lgForgot').onclick = async () => { const { email } = vals(); if (!email) return msg('Enter your email first', true); try { await resetPassword(email); msg('Password reset email sent.'); } catch (e) { msg(e.message, true); } };
  setTimeout(() => $('#lgEmail').focus(), 50);
}
function askPinLocal() {
  sheet(`<h3>🛠 Staff view</h3><p class="muted">See detected problems, all settings, the 3D insole with zones, and download print-ready STL files.</p><p class="alert info" style="text-align:center"><b>Demo PIN: 1234</b></p><input id="pinIn" type="password" inputmode="numeric" maxlength="6" placeholder="Enter PIN" style="width:100%;font-size:22px;padding:14px;border-radius:14px;border:2px solid #e2e9f1;text-align:center;letter-spacing:6px"><button class="btn primary big" id="pinOk">Open staff dashboard</button>`);
  const ok = () => { if ($('#pinIn').value === STAFF_PIN) { $('#sheet').classList.add('hidden'); setStaff(true); } else { $('#pinIn').value = ''; $('#pinIn').placeholder = 'Wrong PIN – try 1234'; } };
  $('#pinOk').onclick = ok; $('#pinIn').onkeydown = e => e.key === 'Enter' && ok(); setTimeout(() => $('#pinIn').focus(), 50);
}
$('#staffBtn').onclick = () => (state.staff ? setStaff(false) : askPin());

/* ---------------- staff dashboard ---------------- */
let staffViewer;
function loadDemoCustomer() {
  makeSimulatedScan('R'); makeSimulatedScan('L');
  state.qa = { pain: ['heel', 'ball'], toes: ['none'], diabetes: 'no', shoewear: 'inner', standing: '8+', activity: 'moderate', weight: '60-90', other: ['none'] };
  ensureProduct(); recompute(); renderStaff(false);
}
$('#loadDemoBtn').onclick = loadDemoCustomer;
function renderStaff(keepView = true) {
  const has = Object.keys(state.feet).length > 0;
  $('#staffEmpty').classList.toggle('hidden', has); $('#staffBody').classList.toggle('hidden', !has);
  if (!has) return;
  recompute(); const p = ensureProduct();
  if (!state.feet[state.side]) state.side = Object.keys(state.feet)[0];
  const side = state.side, f = state.feet[side], spec = currentSpec(side), d = productDims(side);
  $$('#staffSideSeg .seg-btn').forEach(b => { b.classList.toggle('active', b.dataset.s === side); b.onclick = () => { state.side = b.dataset.s; state.highlight = null; renderStaff(); }; });
  // customer
  $('#staffCustomer').innerHTML = `<dl class="summary"><dt>Feet</dt><dd>${['L', 'R'].map(s => state.feet[s] ? `${sideName(s)} ${state.feet[s].length}×${state.feet[s].width} mm (${state.feet[s].source === 'file' ? 'file' : 'demo scan'})` : `${sideName(s)}: not scanned`).join('<br>')}</dd>
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
  $('#staffTemplate').value = p.kind === 'insole' ? state.base : ''; $('#staffTemplate').disabled = p.kind !== 'insole';
  const om = openingMode(p); $('#openWrap').classList.toggle('hidden', !om);
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
  const useTpl = state.base && p.kind === 'insole' && templateCache[state.base];
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
  $('#fitTitle').textContent = `${sideName(side)} foot · ${p.name}${state.base && p.kind === 'insole' ? ' · template ' + state.base : ''}`;
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
    ['Model', fv.scanBased ? (state.base && p.kind === 'insole' ? `template ${state.base} morphed to scan` : 'total contact from plantar map') : 'generic (total contact OFF)']].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('#fitMods').innerHTML = fit.modStats.length ? `<p class="tiny muted" style="margin:8px 0 4px">Intentional clinical modifications (excluded from the score, hatched on the map):</p><table class="params">${fit.modStats.map(m => `<tr><td>${m.name}</td><td>${m.areaCm2} cm² · mean ${m.mean > 0 ? '+' : ''}${m.mean} mm</td></tr>`).join('')}</table>` : '';
  $('#fitNote').textContent = fit.verdict === 'PASS' ? 'PASS: mean gap under 1 mm and at least 80% of the contact area within ±1 mm.' : fit.verdict === 'WARN' ? 'WARN: check the scan alignment, the shoe size (trimmed length) or the arch fill before printing.' : 'FAIL: the product does not follow this scan – turn total contact ON or re-check the scan.';
}
$('#fitGhost').onchange = () => renderFit(true);
$$('#fitViews button').forEach(b => b.onclick = () => fitViewer?.view(b.dataset.view, true, fitViewer.medialX));
$('#staffProduct').onchange = e => { const pr = R.PRODUCTS.find(x => x.id === e.target.value); state.product = pr; state.color = pr.colors[0]; state.strapColor = pr.strapColors?.[0]; renderStaff(false); };
$('#openChk').onchange = e => { state.openings.on = e.target.checked; renderStaff(); };
$('#openDensity').onchange = e => { state.openings.density = e.target.value; renderStaff(); };
$('#openDia').onchange = e => { state.openings.d = +e.target.value; renderStaff(); };
$('#staffTemplate').onchange = async e => { state.base = e.target.value; if (state.base) { try { toast('Loading template…'); await loadTemplate(state.base); } catch (err) { toast('Could not load template: ' + err.message); state.base = ''; } } renderStaff(false); };
let staffOrderId = null;
const getStaffOrderId = () => (staffOrderId ||= newOrderId());
$('#dlStlR').onclick = () => { const s = buildStl('R', getStaffOrderId()); download(s.name, s.data, 'model/stl'); toast('Right STL downloaded (' + s.info.sizeMm.join(' × ') + ' mm)'); };
$('#dlStlL').onclick = () => { const s = buildStl('L', getStaffOrderId()); download(s.name, s.data, 'model/stl'); toast('Left STL downloaded (' + s.info.sizeMm.join(' × ') + ' mm)'); };
$('#dlSpec').onclick = () => { const id = getStaffOrderId(); const infos = ['R', 'L'].map(s => buildStl(s, id).info); download(`${id}-spec.json`, JSON.stringify(buildSpec(id, infos), null, 2), 'application/json'); toast('Spec downloaded'); };


/* ---------------- on-device CRM (localStorage, demo) ---------------- */
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
    settings: { productId: state.product?.id || null, color: state.color, strapColor: state.strapColor || null, base: state.base, sizeMode: state.sizeMode, integrate: state.integrate, totalContact: state.totalContact, openings: { ...state.openings },
      perFoot: Object.fromEntries(Object.entries(sp).map(([s, x]) => [s, { archType: x.archType, archHeight: x.params.archHeight, heelCupDepth: x.params.heelCupDepth, medialPost: x.params.medialPost, lateralWedge: x.params.lateralWedge, heelLift: x.params.heelLift, metPad: x.params.metPad, shore: x.params.shore }])) }
  };
}
function saveCurrentCustomer(name, phone) {
  const list = crmAll(), now = new Date().toISOString();
  let c = state.customerId && list.find(x => x.id === state.customerId);
  if (!c && phone) c = list.find(x => x.phone && x.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
  if (!c) { c = { id: newCustId(), createdAt: now, orders: [] }; list.unshift(c); }
  Object.assign(c, { name: name || c.name || 'Walk-in customer', phone: phone ?? c.phone ?? '', updatedAt: now }, snapshot());
  state.customerId = c.id; crmSave(list);
  if (cloudOn()) { const files = rawMeshFiles(); cloudJob('save', () => saveCustomerCloud(c, files)); }
  return c;
}
function recordOrder(id, by, spec = null, stls = []) {
  const list = crmAll(); let c = list.find(x => x.id === state.customerId);
  if (!c) { c = saveCurrentCustomer($('#custName')?.value.trim() || 'Walk-in customer', $('#custPhone')?.value.trim() || ''); return recordOrder(id, by, spec, stls); }
  const p = ensureProduct(), lines = priceLines(currentSpec());
  Object.assign(c, snapshot(), { updatedAt: new Date().toISOString() });
  c.orders = c.orders || []; if (!c.orders.some(o => o.id === id)) c.orders.unshift({ id, date: new Date().toISOString(), productId: p.id, product: p.name, color: state.color, base: state.base || 'parametric', sides: Object.keys(state.feet), total: lines.reduce((s, l) => s + l[1], 0), by });
  crmSave(list);
  if (cloudOn()) { const o = c.orders.find(o => o.id === id), sp = spec || buildSpec(id, stls.map(x => x.info)); cloudJob('order', () => saveCustomerCloud(c, rawMeshFiles()).then(() => insertOrderCloud(c, o, sp, stls))); }
}
function loadCustomer(c) {
  state.feet = JSON.parse(JSON.stringify(c.feet || {})); state.uploaded = {}; state.archOverride = { ...(c.archOverride || {}) };
  state.qa = JSON.parse(JSON.stringify(c.qa || {})); state.staffAdds = new Set(c.staffAdds || []); state.staffRemoves = new Set(c.staffRemoves || []);
  if (c.lld) { state.answers.lldMm = c.lld.mm; state.answers.lldSide = c.lld.side; }
  const s = c.settings || {}; state.product = R.PRODUCTS.find(x => x.id === s.productId) || null; state.color = s.color || state.product?.colors[0]; state.strapColor = s.strapColor || state.product?.strapColors?.[0];
  state.base = s.base || ''; state.sizeMode = s.sizeMode || 'scan'; state.integrate = s.integrate !== false; state.totalContact = s.totalContact !== false; state.openings = { on: true, density: 'med', d: 3.5, ...(s.openings || {}) };
  state.customerId = c.id; state.side = state.feet.R ? 'R' : 'L'; staffOrderId = null; recompute();
}
function seedCRM() {
  if (localStorage.getItem(CRM_KEY)) return;
  const foot = (side, archType, length, csi, peak) => ({ side, source: 'demo', archType, length, width: Math.round(length * 0.395), csi, ahi: { high: .37, normal: .34, low: .315, flat: .29 }[archType], peakForefootPressure: peak });
  const d = (days) => new Date(Date.now() - days * 864e5).toISOString();
  crmSave([
    { id: 'C-DEMO1', name: 'Maria Santos', phone: '0917 555 0101', createdAt: d(21), updatedAt: d(21), feet: { R: foot('R', 'flat', 238, 66, .7), L: foot('L', 'low', 240, 52, .72) }, archOverride: {}, qa: { pain: ['heel'], toes: ['none'], diabetes: 'no', shoewear: 'inner', standing: '8+', activity: 'moderate', weight: '60-90', other: ['none'] }, staffAdds: [], staffRemoves: [], conditions: [], settings: { productId: 'fullcontact', color: '#c8784a', base: '', sizeMode: 'scan', integrate: true, totalContact: true },
      orders: [{ id: 'FXF-DEMO-0001', date: d(21), productId: 'fullcontact', product: 'Full-contact TPU insole', color: '#c8784a', base: 'parametric', sides: ['R', 'L'], total: 2940, by: 'customer' }] },
    { id: 'C-DEMO2', name: 'Jose Reyes', phone: '0918 555 0202', createdAt: d(9), updatedAt: d(2), feet: { R: foot('R', 'high', 268, 12, .95), L: foot('L', 'high', 266, 15, .9) }, archOverride: {}, qa: { pain: ['ball'], toes: ['claw'], diabetes: 'yes', shoewear: 'even', standing: '4-8', activity: 'low', weight: '90+', other: ['none'] }, staffAdds: [], staffRemoves: [], conditions: [], settings: { productId: 'flipflop', color: '#3a3f3a', strapColor: '#d8c6a8', base: '', sizeMode: 'scan', integrate: true, totalContact: true },
      orders: [{ id: 'FXF-DEMO-0002', date: d(9), productId: 'flipflop', product: 'Classic thong flip-flop', color: '#3a3f3a', base: 'parametric', sides: ['R', 'L'], total: 3590, by: 'production' }, { id: 'FXF-DEMO-0003', date: d(2), productId: 'fullcontact', product: 'Full-contact TPU insole', color: '#1f2a30', base: 'parametric', sides: ['R', 'L'], total: 3090, by: 'production' }] }
  ]);
}
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
function renderCRM() {
  const q = ($('#crmSearch').value || '').toLowerCase().trim(), list = crmAll();
  const hits = list.filter(c => !q || [c.name, c.phone, c.id, ...(c.orders || []).map(o => o.id)].join(' ').toLowerCase().includes(q));
  $('#crmCount').innerHTML = `${hits.length} of ${list.length} customers · ${cloudOn() ? `in Supabase cloud · signed in as ${esc(Cloud.profile.email)} (${Cloud.profile.role}) <span id="crmSync"></span>` : Cloud.configured ? 'saved on this device (offline / not signed in)' : 'saved on this device'}`;
  renderCloudTools();
  $('#crmList').innerHTML = hits.length ? hits.map(c => {
    const feet = ['R', 'L'].filter(s => c.feet?.[s]).map(s => `${s}: ${R.ARCH_TYPES[c.archOverride?.[s] || c.feet[s].archType]?.short} · ${c.feet[s].length} mm`).join(' &nbsp;|&nbsp; ');
    return `<div class="crm-item ${c.id === state.customerId ? 'on' : ''}" data-id="${esc(c.id)}"><div class="crm-av">${esc((c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
      <div class="crm-main"><b>${esc(c.name)}</b><span>${esc(c.phone || 'no phone')} · ${(c.orders || []).length} order(s)</span><small>${feet || 'no scan'}</small></div><span class="crm-go">›</span></div>`;
  }).join('') : '<p class="muted center">No customers found.</p>';
  $$('#crmList .crm-item').forEach(el => el.onclick = () => openCustomer(el.dataset.id));
}
function openCustomer(id) {
  const c = crmAll().find(x => x.id === id); if (!c) return;
  const probs = problemNames(c), s = c.settings || {}, pf = s.perFoot && Object.keys(s.perFoot).length ? s.perFoot : probs.perFoot;
  sheet(`<div class="row-between"><h3 style="margin:0">${esc(c.name)}</h3><span class="tag" title="${esc(c.id)}">${esc(String(c.id).length > 12 ? String(c.id).slice(0, 8) : c.id)}</span></div>
    <p class="muted small" style="margin:4px 0 10px">📞 ${esc(c.phone || '–')} · customer since ${fmtDate(c.createdAt)}</p>
    <h4 class="crm-h">Saved scans</h4><div class="crm-feet">${['R', 'L'].map(sd => { const f = c.feet?.[sd]; return `<div class="crm-foot"><b>${sideName(sd)}</b>${f ? `<span>${R.ARCH_TYPES[c.archOverride?.[sd] || f.archType].short}</span><span>${f.length} × ${f.width} mm · EU ${sizeFromLength(f.length).eu}</span><span class="tiny muted">${f.meshPath ? '☁️ raw scan in Storage · ' : ''}${f.source === 'file' ? 'file ' + esc(f.file) + (f.map ? ' · 2 mm plantar map ✓' : '') : 'demo scan'} · CSI ${f.csi}%</span>` : '<span class="muted">not scanned</span>'}</div>`; }).join('')}</div>
    <h4 class="crm-h">Detected problems</h4><div class="zone-chips">${probs.length ? probs.map(n => `<span class="zchip">${esc(n)}</span>`).join('') : '<span class="muted small">none</span>'}</div>
    <h4 class="crm-h">Last settings</h4><table class="params">${Object.entries(pf).map(([sd, x]) => `<tr><td>${sideName(sd)}</td><td>${R.ARCH_TYPES[x.archType]?.short} · arch ${x.archHeight} mm · cup ${x.heelCupDepth} mm${x.medialPost ? ' · post ' + x.medialPost + '°' : ''}${x.lateralWedge ? ' · wedge ' + x.lateralWedge + '°' : ''}${x.heelLift ? ' · lift ' + x.heelLift + ' mm' : ''}${x.metPad ? ' · met pad' : ''} · ${x.shore}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">–</td></tr>'}
      <tr><td>Product</td><td>${esc(R.PRODUCTS.find(p => p.id === s.productId)?.name || '–')}${s.base ? ' · template ' + esc(s.base) : ''}</td></tr></table>
    <h4 class="crm-h">Order history</h4>${(c.orders || []).length ? `<div class="crm-orders">${c.orders.map(o => `<div class="row-between"><span><b>${esc(o.id)}</b><br><small class="muted">${fmtDate(o.date)} · ${esc(o.product)} · ${o.sides.join('+')}</small></span><span>${peso(o.total)}</span></div>`).join('')}</div>` : '<p class="muted small">No orders yet.</p>'}
    <button class="btn primary big" id="crmReorder">↻ New order from saved scan</button>
    <div class="crm-actions"><button class="btn ghost" id="crmLoad">Open in dashboard</button><button class="btn ghost" id="crmDel"${cloudOn() && !Cloud.isAdmin ? ' disabled title="Admins only"' : ''}>Delete</button></div>
    <p class="tiny muted">Re-order regenerates both STL files from the stored scan data and settings – no rescan needed.</p>`);
  $('#crmLoad').onclick = () => { loadCustomer(c); $('#sheet').classList.add('hidden'); show('s-staff'); toast(c.name + ' loaded'); };
  $('#crmReorder').onclick = () => {
    loadCustomer(c); ensureProduct(); $('#sheet').classList.add('hidden');
    const id = newOrderId(), stls = Object.keys(state.feet).map(sd => buildStl(sd, id));
    const spec = { ...buildSpec(id, stls.map(x => x.info)), customer: { id: c.id, name: c.name, phone: c.phone }, reorderFromSavedScan: true };
    download(`${id}-spec.json`, JSON.stringify(spec, null, 2), 'application/json');
    stls.forEach((x, i) => setTimeout(() => download(x.name, x.data, 'model/stl'), 400 * (i + 1)));
    recordOrder(id, 'reorder', spec, stls); show('s-staff'); toast(`Re-order ${id}: ${stls.length} STL + spec regenerated from saved scan`, 4200);
  };
  $('#crmDel').onclick = async () => {
    if (cloudOn() && !Cloud.isAdmin) { toast('Only an admin can delete customers'); return; }
    if (!confirm('Delete ' + c.name + (cloudOn() ? ' (cloud record, scans and STL files)?' : ' from this device?'))) return;
    if (cloudOn()) { try { await cloudQueue; await deleteCustomerCloud(c); } catch (e) { toast('Delete failed: ' + e.message, 4500); return; } }
    crmSave(crmAll().filter(x => x.id !== c.id)); if (state.customerId === c.id) state.customerId = null; $('#sheet').classList.add('hidden'); renderCRM(); };
}
$('#crmSearch').oninput = renderCRM;
$('#crmBtn').onclick = () => show('s-crm');
$('#crmSaveBtn').onclick = () => {
  const cur = crmAll().find(x => x.id === state.customerId);
  sheet(`<h3>Save customer</h3><label class="field">Name<input id="svName" value="${esc(cur?.name || '')}" placeholder="Full name"></label><label class="field">Mobile<input id="svPhone" inputmode="tel" value="${esc(cur?.phone || '')}" placeholder="09xx xxx xxxx"></label><button class="btn primary big" id="svOk">Save scans + settings</button>`);
  $('#svOk').onclick = () => { const n = $('#svName').value.trim(); if (!n) return toast('Name required'); const c = saveCurrentCustomer(n, $('#svPhone').value.trim()); $('#sheet').classList.add('hidden'); toast('Saved: ' + c.name); renderStaff(); };
};
$('#crmNewBtn').onclick = () => { state.feet = {}; state.uploaded = {}; state.qa = {}; state.staffAdds = new Set(); state.staffRemoves = new Set(); state.archOverride = {}; state.customerId = null; state.product = null; show('s-scan'); };

/* ---------------- screen enter hooks ---------------- */
const onEnter = {
  's-scan': () => { state.side = state.feet.R && !state.feet.L ? 'L' : 'R'; syncSideSeg(); resetRing(); },
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
const guard = id => SCREENS.indexOf(id) >= 2 && !Object.keys(state.feet).length;
const _show = show;
window.fixiGo = id => _show(id); // debug helper
$$('[data-go]').forEach(b => b.addEventListener('click', e => { if (guard(b.dataset.go)) { e.stopImmediatePropagation(); toast('Please scan a foot first'); show('s-scan'); } }, true));
// demo shortcut: ?demo=flat jumps to a ready-made profile (useful for sales demos / screenshots)
const qp = new URLSearchParams(location.search);
if (qp.get('staff') === '1') state.staff = true;
document.body.classList.toggle('staff', state.staff);
if (qp.get('demo')) {
  makeSimulatedScan('R'); if (qp.get('both') === '1') makeSimulatedScan('L'); const a = qp.get('demo'); if (R.ARCH_TYPES[a]) state.feet.R.archType = a;
  if (qp.get('cond')) qp.get('cond').split(',').forEach(id => state.staffAdds.add(id));
  recompute();
  if (qp.get('product')) { state.product = R.PRODUCTS.find(p => p.id === qp.get('product')); state.color = state.product?.colors[0]; state.strapColor = state.product?.strapColors?.[0]; }
}
window.__fixiFit = { alignScan, rasterizePlantar, deriveModel, buildContactSole, morphTemplate, toPrintable, fitCheck, buildFoot, STLLoader, OBJLoader, STLExporter, THREE, loadTemplate, templateCache, footModel, fitFor, buildStl, state, objToGeo };
seedCRM();
// v5 cloud init: no keys in config.js -> purely offline demo (PIN + on-device CRM)
if (Cloud.configured) initCloud().then(() => {
  if (!Cloud.online) { toast('Cloud unreachable – working offline on this device', 3500); }
  else if (sessionStorage.getItem('fxStaff') === '1' && Cloud.ready) setStaff(true);
  onCloudChange(() => { if (state.staff && Cloud.online && !Cloud.ready) setStaff(false); renderBanner(); });
  renderBanner();
});
show(qp.get('demo') && qp.get('screen') ? qp.get('screen') : 's-welcome');
// branded splash
setTimeout(() => $('#splash')?.classList.add('gone'), qp.get('nosplash') ? 0 : 1100); setTimeout(() => $('#splash')?.remove(), qp.get('nosplash') ? 0 : 1700);
