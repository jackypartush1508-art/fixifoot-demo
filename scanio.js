// Fixifoot v14 – load foot scans from the Files app on iPad / iPhone (STL, OBJ, PLY, or a ZIP of an OBJ).
// Detects type by file name and by file contents (iOS often hides or mis-labels 3D files). Large meshes are
// downsampled before alignment so iPad Safari stays within its memory budget.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/STLLoader.js';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { PLYLoader } from 'three/addons/PLYLoader.js';

export const SCAN_ACCEPT = '.stl,.obj,.ply,.zip,application/zip,application/x-zip-compressed,application/octet-stream,model/stl,model/obj,model/ply,text/plain,*/*';
export const MAX_TRIS = 500000; // downsample above this before processing
export const MAX_BYTES = 80 * 1024 * 1024; // hard cap (~80 MB) – bigger files will almost certainly crash iPad Safari

const enc = new TextDecoder('utf-8', { fatal: false });
const startsWith = (u, s) => { for (let i = 0; i < s.length; i++) if (u[i] !== s.charCodeAt(i)) return false; return true; };
const looksText = u => { const n = Math.min(u.length, 256); let t = 0; for (let i = 0; i < n; i++) { const c = u[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) t++; } return t / n > .85; };

export function sniffScan(name, buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const n = (name || '').split(/[/\\]/).pop() || '';
  if (/\.zip$/i.test(n) || (u[0] === 0x50 && u[1] === 0x4b && (u[2] === 0x03 || u[2] === 0x05 || u[2] === 0x07))) return 'zip';
  if (/\.stl$/i.test(n)) return 'stl';
  if (/\.obj$/i.test(n)) return 'obj';
  if (/\.ply$/i.test(n)) return 'ply';
  if (u.length >= 4 && startsWith(u, 'ply\n') || startsWith(u, 'ply\r')) return 'ply';
  if (u.length >= 5 && (startsWith(u, 'solid') || startsWith(u, 'SOLID'))) return 'stl';
  if (u.length >= 84) { // binary STL: 80-byte header + uint32 triangles, each 50 bytes
    const tris = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(80, true);
    if (tris > 0 && tris < 2e7 && u.length === 84 + tris * 50) return 'stl';
  }
  if (looksText(u)) {
    const head = enc.decode(u.subarray(0, Math.min(u.length, 800)));
    if (/^\s*(v|vn|vt|f|o|g|s|mtllib|usemtl|#)\s/m.test(head)) return 'obj';
    if (/^ply\b/i.test(head)) return 'ply';
    if (/^\s*solid\b/i.test(head)) return 'stl';
  }
  return null;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This iPad cannot open compressed ZIP files. Please export an uncompressed ZIP, or a plain STL / OBJ / PLY.');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

export async function unzip(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1;
  for (let i = Math.max(0, u.length - 22 - 65536); i <= u.length - 22; i++) if (dv.getUint32(i, true) === 0x06054b50) eocd = i;
  if (eocd < 0) throw new Error('That ZIP file looks damaged. Please export a plain STL, OBJ or PLY from the scanner app.');
  const n = dv.getUint16(eocd + 8, true), off = dv.getUint32(eocd + 16, true);
  const files = [];
  let p = off;
  for (let k = 0; k < n; k++) {
    if (p + 46 > u.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = enc.decode(u.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\./.test(name)) continue;
    if (loff + 30 > u.length || dv.getUint32(loff, true) !== 0x04034b50) continue;
    const ln = dv.getUint16(loff + 26, true), lx = dv.getUint16(loff + 28, true);
    const start = loff + 30 + ln + lx, data = u.subarray(start, start + csz);
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = await inflateRaw(data);
    else throw new Error('This ZIP uses a compression type this iPad cannot open. Please export a plain STL, OBJ or PLY, or an uncompressed ZIP.');
    files.push({ name, data: raw });
  }
  if (!files.length) throw new Error('That ZIP is empty. Please export a plain STL, OBJ or PLY from the scanner app.');
  return files;
}

function pickMeshFromZip(files) {
  const of = ext => files.filter(f => new RegExp('\\.' + ext + '$', 'i').test(f.name) && f.data.length);
  const stl = of('stl'), ply = of('ply'), obj = of('obj');
  if (obj.length) {
    const o = obj.sort((a, b) => b.data.length - a.data.length)[0];
    const base = o.name.replace(/[^/]+$/, '');
    const mtl = files.find(f => /\.mtl$/i.test(f.name) && f.name.startsWith(base)) || files.find(f => /\.mtl$/i.test(f.name));
    return { kind: 'obj', name: o.name, data: o.data, mtl };
  }
  const mesh = [...stl, ...ply].sort((a, b) => b.data.length - a.data.length)[0];
  if (mesh) return { kind: /\.ply$/i.test(mesh.name) ? 'ply' : 'stl', name: mesh.name, data: mesh.data };
  const names = files.map(f => f.name.split('/').pop()).join(', ');
  throw new Error('No STL, OBJ or PLY was found in that ZIP (it contained: ' + names + '). Please export the scan as STL, OBJ or PLY, or ZIP the OBJ with its MTL file.');
}

function parseKind(kind, data, name) {
  if (kind === 'stl') return new STLLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (kind === 'ply') return new PLYLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (kind === 'obj') {
    let text = enc.decode(data);
    // OBJLoader needs a string; missing normals are fine (we only use positions). Drop mtllib so a missing MTL cannot fail the load.
    text = text.replace(/^\s*mtllib\s+[^\r\n]+/gm, '# mtllib skipped');
    return new OBJLoader().parse(text);
  }
  throw new Error('Please choose an STL, OBJ, PLY, or a ZIP that contains one of those.');
}

// Voxel clustering: collapse vertices to a grid, drop degenerate triangles. Fast and memory-light (good on iPad).
export function decimateGeometry(geo, maxTris = MAX_TRIS, onProgress) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const P = src.attributes.position, nT = (P.count / 3) | 0;
  if (nT <= maxTris) return src;
  onProgress?.('Large scan (' + nT.toLocaleString() + ' triangles) – simplifying so this iPad can handle it…');
  src.computeBoundingBox();
  const bb = src.boundingBox, size = bb.max.clone().sub(bb.min);
  const span = Math.max(size.x, size.y, size.z) || 1;
  // aim for ~maxTris cells on the surface; start coarse and refine if we overshoot badly
  let cell = span / Math.cbrt(maxTris * 4);
  const keyOf = (x, y, z) => ((Math.round((x - bb.min.x) / cell) * 73856093) ^ (Math.round((y - bb.min.y) / cell) * 19349663) ^ (Math.round((z - bb.min.z) / cell) * 83492791)) >>> 0;
  const map = new Map(), out = [];
  const snap = i => {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = keyOf(x, y, z);
    let v = map.get(k); if (!v) { v = [x, y, z]; map.set(k, v); } return v;
  };
  for (let t = 0; t < nT; t++) {
    if ((t & 0xffff) === 0) onProgress?.('Simplifying… ' + Math.min(99, Math.round(t / nT * 100)) + '%');
    const a = snap(3 * t), b = snap(3 * t + 1), c = snap(3 * t + 2);
    if (a === b || b === c || c === a) continue;
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  if (src !== geo) src.dispose();
  if (!out.length) throw new Error('The scan became empty after simplifying. Please try a smaller export from the scanner app.');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  onProgress?.('Simplified to ' + ((out.length / 9) | 0).toLocaleString() + ' triangles');
  return g;
}

export function triangleCount(geo) {
  if (!geo) return 0;
  const n = geo.attributes.position?.count || 0;
  return geo.index ? (geo.index.count / 3) | 0 : (n / 3) | 0;
}

export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse?.(o => { o.geometry?.dispose?.(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { m.map?.dispose?.(); m.dispose?.(); } } });
  if (obj.isBufferGeometry) obj.dispose();
}

export async function loadScanFile(file, { onProgress } = {}) {
  if (!file) throw new Error('No file selected');
  if (file.size > MAX_BYTES) throw new Error('This file is too large for this iPad (' + (file.size / 1048576).toFixed(0) + ' MB). Please export a smaller or simplified scan (STL, OBJ or PLY under 80 MB).');
  onProgress?.('Reading ' + (file.name || 'scan') + '…');
  const buf = new Uint8Array(await file.arrayBuffer());
  let kind = sniffScan(file.name, buf), name = file.name || 'scan', data = buf;
  if (kind === 'zip') {
    onProgress?.('Opening ZIP…');
    const picked = pickMeshFromZip(await unzip(buf));
    kind = picked.kind; name = picked.name; data = picked.data;
  }
  if (!kind) throw new Error('This does not look like an STL, OBJ, PLY, or a ZIP of those. In the Files app choose the scan export from 3d Scanner App, Polycam or Heges.');
  onProgress?.('Parsing ' + name + '…');
  const obj = parseKind(kind, data, name);
  return { obj, name, kind, bytes: data.length };
}
