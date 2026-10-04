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
    await pingCloud();
  } catch (e) { Cloud.online = false; Cloud.lastError = e.message; console.warn('cloud offline', e); }
  return Cloud;
}
// v10: is the cloud reachable? (auth health endpoint, 6 s timeout) – the offline PIN is only offered when this fails
export async function pingCloud() {
  if (!Cloud.configured) return false;
  if (navigator.onLine === false) { Cloud.online = false; return false; }
  try { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(cfg.url.replace(/\/$/, '') + '/auth/v1/health', { headers: { apikey: cfg.anonKey }, signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
    Cloud.online = r.status < 500; } catch (e) { Cloud.online = false; Cloud.lastError = e.message; }
  emit(); return Cloud.online;
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
    sb.from('orders').select('id,order_no,customer_id,product,color,size,status,stl_paths,settings,design,price_php,payment_method,paid,discount,receipt_no,status_history,status_updated_at,scan_pending,created_at').order('created_at', { ascending: false }).limit(2000)]);
  const C = must(cs), S = must(sc), O = must(os);
  return C.map(c => {
    const feet = {}, scanIds = {};
    const scanHistory = [];
    for (const s of S.filter(s => s.customer_id === c.id)) {
      scanHistory.push({ id: s.id, side: s.side, source: s.source, date: s.created_at, meshPath: s.mesh_path || null, hasMap: !!s.plantar_map, ...(s.metrics || {}) });
      if (!feet[s.side]) { feet[s.side] = { ...s.metrics, side: s.side, source: s.source, ...(s.plantar_map ? { map: s.plantar_map } : {}), meshPath: s.mesh_path || null }; scanIds[s.side] = s.id; }
    }
    const p = c.profile || {}, sig = {}; for (const sd in feet) sig[sd] = scanSig(feet[sd]);
    return { id: c.id, cloud: true, scanSig: sig, name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '', tags: c.tags || [], scanPending: !!c.scan_pending, scanHistory, createdAt: c.created_at, updatedAt: c.updated_at,
      feet, scanIds, archOverride: p.archOverride || {}, qa: p.qa || {}, lld: p.lld, staffAdds: p.staffAdds || [], staffRemoves: p.staffRemoves || [], conditions: p.conditions || [], settings: p.settings || {},
      orders: O.filter(o => o.customer_id === c.id).map(o => ({ id: o.order_no, uuid: o.id, date: o.created_at, productId: o.settings?.productId || null, product: o.product, color: o.color, base: o.settings?.base || 'parametric', sides: o.settings?.sides || [], total: o.price_php ?? o.settings?.total ?? 0, by: o.settings?.by || 'staff', status: o.status, stlPaths: o.stl_paths || [], design: o.design || null, size: o.size || null, feetInfo: o.settings?.feetInfo || null,
        statusHistory: o.status_history || [], statusAt: o.status_updated_at || null, scanPending: !!o.scan_pending,
        payment: { method: o.payment_method || null, paid: !!o.paid, discount: +(o.discount || 0), receiptNo: o.receipt_no || null, notes: o.settings?.receipt?.notes || null, staffName: o.settings?.receipt?.staffName || null } })) };
  });
}
// upsert customer + profile, insert a scan row per side whose data changed (with optional raw mesh upload)
export async function saveCustomerCloud(c, meshFiles = {}) {
  const sb = Cloud.client;
  const profile = { archOverride: c.archOverride, qa: c.qa, lld: c.lld, staffAdds: c.staffAdds, staffRemoves: c.staffRemoves, conditions: c.conditions, settings: c.settings };
  must(await sb.from('customers').upsert({ id: c.id, name: c.name, phone: c.phone || null, email: c.email || null, notes: c.notes || null, tags: c.tags || [], scan_pending: !!c.scanPending, profile }, { onConflict: 'id' }));
  c.scanSig ||= {}; c.scanIds ||= {};
  for (const side of ['R', 'L']) {
    const f = c.feet?.[side]; if (!f) continue;
    const { map, meshPath, ...metrics } = f, sig = scanSig(f);
    if (c.scanSig[side] === sig) continue;
    let mesh_path = meshPath || null;
    const scanId = crypto.randomUUID();
    if (meshFiles[side]) { mesh_path = `${c.id}/${scanId}-${side}.stl`; must(await sb.storage.from('scans').upload(mesh_path, meshFiles[side], { contentType: 'model/stl', upsert: false })); }
    must(await sb.from('scans').insert({ id: scanId, customer_id: c.id, side, source: ['file', 'manual', 'sample', 'self'].includes(f.source) ? f.source : 'demo', mesh_path, plantar_map: map || null, metrics }));
    c.scanSig[side] = sig; c.scanIds[side] = scanId; f.meshPath = mesh_path;
  }
  return c;
}
export async function insertOrderCloud(c, o, spec, stls = []) {
  const sb = Cloud.client, paths = [];
  for (const s of stls) { const path = `${c.id}/${o.id}/${s.name}`; must(await sb.storage.from('stl').upload(path, new Blob([s.data], { type: 'model/stl' }), { contentType: 'model/stl', upsert: true })); paths.push(path); }
  const row = { order_no: o.id, scan_pending: !!o.scanPending, customer_id: c.id, product: o.product, color: o.color, size: spec?.size ? 'EU ' + spec.size.eu : null, problems: spec?.conditions || [],
    settings: { productId: o.productId, base: o.base, sides: o.sides, total: o.total, by: o.by, feetInfo: o.feetInfo || null, receipt: { notes: o.payment?.notes || null, staffName: o.payment?.staffName || null } }, spec: spec || null, stl_paths: paths,
    // v10: payment + receipt (migration 20261004180000_orders_payment)
    payment_method: o.payment?.method || null, paid: !!o.payment?.paid, discount: o.payment?.discount || 0, receipt_no: o.payment?.receiptNo || o.id,
    // v9: design chosen before the scan (migration 20261004160000_orders_design)
    design: o.design || spec?.design || null, price_php: o.total ?? null, engraving_text: (o.design || spec?.design)?.text || null,
    color_ext1: (o.design || spec?.design)?.colors?.extruder1?.hex || null, color_ext2: (o.design || spec?.design)?.colors?.extruder2?.hex || null };
  must(await sb.from('orders').upsert(row, { onConflict: 'order_no' }));
  return paths;
}
// v10: payment fields of an existing order (staff update policy); notes / staff name are merged into settings.receipt
export async function updateOrderPaymentCloud(orderNo, p) {
  const sb = Cloud.client, cur = must(await sb.from('orders').select('settings').eq('order_no', orderNo).maybeSingle());
  if (!cur) return null; // not uploaded yet (e.g. saved while offline) – sent with the order upload
  const settings = { ...(cur.settings || {}), receipt: { notes: p.notes || null, staffName: p.staffName || null } };
  return must(await sb.from('orders').update({ payment_method: p.method || null, paid: !!p.paid, discount: p.discount || 0, receipt_no: p.receiptNo || orderNo, settings }).eq('order_no', orderNo).select('id'));
}
// v11.1: scan added later -> clear the pending flag on the order(s)
export async function clearScanPendingCloud(orderNos) {
  if (!orderNos.length) return [];
  return must(await Cloud.client.from('orders').update({ scan_pending: false }).in('order_no', orderNos).select('order_no'));
}
// v11: order status pipeline – the server trigger appends {status, at, by} to status_history
export async function updateOrderStatusCloud(orderNo, status) {
  const d = must(await Cloud.client.from('orders').update({ status }).eq('order_no', orderNo).select('status,status_history,status_updated_at'));
  return d[0] || null;
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
