// Fixifoot v5 – Supabase cloud CRM (staff only). Uses ONLY the public anon key; all access is enforced by RLS.
// Configure in config.js: window.FIXI_CLOUD = { url: 'https://<ref>.supabase.co', anonKey: '<anon/publishable key>' }
import { createClient } from './vendor/supabase.esm.js';

const cfg = window.FIXI_CLOUD || {};
export const Cloud = {
  configured: !!(cfg.url && cfg.anonKey),
  client: null, session: null, profile: null, online: true, lastError: null,
  get ready() { return !!(this.client && this.session && this.profile && ['staff', 'admin'].includes(this.profile.role)); },
  get isAdmin() { return this.profile?.role === 'admin'; },
};
const listeners = [];
export const onCloudChange = fn => listeners.push(fn);
const emit = () => listeners.forEach(fn => { try { fn(Cloud); } catch (e) { console.warn(e); } });

export async function initCloud() {
  if (!Cloud.configured) return Cloud;
  try {
    Cloud.client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fxSupabaseAuth' } });
    const { data } = await Cloud.client.auth.getSession();
    Cloud.session = data.session; if (Cloud.session) await loadProfile();
    Cloud.client.auth.onAuthStateChange(async (_e, session) => { Cloud.session = session; Cloud.profile = null; if (session) await loadProfile(); emit(); });
  } catch (e) { Cloud.online = false; Cloud.lastError = e.message; console.warn('cloud offline', e); }
  return Cloud;
}
async function loadProfile() {
  const { data, error } = await Cloud.client.from('staff_profiles').select('user_id,email,name,role').eq('user_id', Cloud.session.user.id).maybeSingle();
  if (error) { Cloud.lastError = error.message; Cloud.online = !/fetch|network/i.test(error.message); }
  Cloud.profile = data || null;
}
export const scanSig = f => JSON.stringify([f.length, f.width, f.archType, f.csi, f.source, f.file || '', f.map ? f.map.nx + 'x' + f.map.nz + ':' + String(f.map.data || '').length : '']);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export async function signIn(email, password) { must(await Cloud.client.auth.signInWithPassword({ email, password })); await loadProfile(); emit(); return Cloud.profile; }
export async function signUp(email, password, name) {
  const d = must(await Cloud.client.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } }));
  return { needsConfirm: !d.session };
}
export async function signOut() { await Cloud.client.auth.signOut(); Cloud.session = null; Cloud.profile = null; emit(); }
export async function resetPassword(email) { must(await Cloud.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); }

// ---------- CRM: cloud rows <-> app's customer shape ----------
// app shape: { id, name, phone, email, notes, createdAt, updatedAt, feet:{R,L}, archOverride, qa, lld, staffAdds, staffRemoves, conditions, settings, orders:[...] }
export async function fetchCustomers() {
  const sb = Cloud.client;
  const [cs, sc, os] = await Promise.all([
    sb.from('customers').select('*').order('updated_at', { ascending: false }).limit(500),
    sb.from('scans').select('id,customer_id,side,source,mesh_path,plantar_map,metrics,created_at').order('created_at', { ascending: false }).limit(2000),
    sb.from('orders').select('id,order_no,customer_id,product,color,size,status,stl_paths,settings,created_at').order('created_at', { ascending: false }).limit(2000)]);
  const C = must(cs), S = must(sc), O = must(os);
  return C.map(c => {
    const feet = {}, scanIds = {};
    for (const s of S.filter(s => s.customer_id === c.id)) if (!feet[s.side]) { feet[s.side] = { ...s.metrics, side: s.side, source: s.source, ...(s.plantar_map ? { map: s.plantar_map } : {}), meshPath: s.mesh_path || null }; scanIds[s.side] = s.id; }
    const p = c.profile || {}, sig = {}; for (const sd in feet) sig[sd] = scanSig(feet[sd]);
    return { id: c.id, cloud: true, scanSig: sig, name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '', createdAt: c.created_at, updatedAt: c.updated_at,
      feet, scanIds, archOverride: p.archOverride || {}, qa: p.qa || {}, lld: p.lld, staffAdds: p.staffAdds || [], staffRemoves: p.staffRemoves || [], conditions: p.conditions || [], settings: p.settings || {},
      orders: O.filter(o => o.customer_id === c.id).map(o => ({ id: o.order_no, uuid: o.id, date: o.created_at, productId: o.settings?.productId || null, product: o.product, color: o.color, base: o.settings?.base || 'parametric', sides: o.settings?.sides || [], total: o.settings?.total || 0, by: o.settings?.by || 'staff', status: o.status, stlPaths: o.stl_paths || [] })) };
  });
}
// upsert customer + profile, insert a scan row per side whose data changed (with optional raw mesh upload)
export async function saveCustomerCloud(c, meshFiles = {}) {
  const sb = Cloud.client;
  const profile = { archOverride: c.archOverride, qa: c.qa, lld: c.lld, staffAdds: c.staffAdds, staffRemoves: c.staffRemoves, conditions: c.conditions, settings: c.settings };
  must(await sb.from('customers').upsert({ id: c.id, name: c.name, phone: c.phone || null, email: c.email || null, notes: c.notes || null, profile }, { onConflict: 'id' }));
  c.scanSig ||= {}; c.scanIds ||= {};
  for (const side of ['R', 'L']) {
    const f = c.feet?.[side]; if (!f) continue;
    const { map, meshPath, ...metrics } = f, sig = scanSig(f);
    if (c.scanSig[side] === sig) continue;
    let mesh_path = meshPath || null;
    const scanId = crypto.randomUUID();
    if (meshFiles[side]) { mesh_path = `${c.id}/${scanId}-${side}.stl`; must(await sb.storage.from('scans').upload(mesh_path, meshFiles[side], { contentType: 'model/stl', upsert: false })); }
    must(await sb.from('scans').insert({ id: scanId, customer_id: c.id, side, source: f.source === 'file' ? 'file' : 'demo', mesh_path, plantar_map: map || null, metrics }));
    c.scanSig[side] = sig; c.scanIds[side] = scanId; f.meshPath = mesh_path;
  }
  return c;
}
export async function insertOrderCloud(c, o, spec, stls = []) {
  const sb = Cloud.client, paths = [];
  for (const s of stls) { const path = `${c.id}/${o.id}/${s.name}`; must(await sb.storage.from('stl').upload(path, new Blob([s.data], { type: 'model/stl' }), { contentType: 'model/stl', upsert: true })); paths.push(path); }
  const row = { order_no: o.id, customer_id: c.id, product: o.product, color: o.color, size: spec?.size ? 'EU ' + spec.size.eu : null, problems: spec?.conditions || [],
    settings: { productId: o.productId, base: o.base, sides: o.sides, total: o.total, by: o.by }, spec: spec || null, stl_paths: paths };
  must(await sb.from('orders').upsert(row, { onConflict: 'order_no' }));
  return paths;
}
export async function deleteCustomerCloud(c) {
  const sb = Cloud.client;
  for (const b of ['scans', 'stl']) {
    const { data } = await sb.storage.from(b).list(c.id, { limit: 1000 });
    const files = [];
    for (const it of data || []) { if (it.id) files.push(`${c.id}/${it.name}`); else { const { data: sub } = await sb.storage.from(b).list(`${c.id}/${it.name}`, { limit: 1000 }); (sub || []).forEach(f => files.push(`${c.id}/${it.name}/${f.name}`)); } }
    if (files.length) must(await sb.storage.from(b).remove(files));
  }
  const d = must(await sb.from('customers').delete().eq('id', c.id).select('id'));
  if (!d.length) throw new Error('Only an admin can delete customers');
}
export async function signedUrl(bucket, path) { return must(await Cloud.client.storage.from(bucket).createSignedUrl(path, 600)).signedUrl; }
export async function listStaff() { return must(await Cloud.client.from('staff_profiles').select('user_id,email,name,role,created_at').order('created_at')); }
export async function setRole(userId, role) { const d = must(await Cloud.client.from('staff_profiles').update({ role }).eq('user_id', userId).select('user_id')); if (!d.length) throw new Error('Only an admin can change roles'); }
