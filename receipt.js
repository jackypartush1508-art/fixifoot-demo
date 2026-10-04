// Fixifoot v10 – PDF receipt generated in the browser (jsPDF, bundled locally: works offline + in the standalone file).
// Not an official BIR receipt: titled "Acknowledgement Receipt" unless the business details (name, address, TIN) are configured.
export const PAY_METHODS = ['Cash', 'GCash', 'Maya', 'Card', 'Bank transfer'];
const BIZ_KEY = 'fxBiz_v1';
export function bizSettings() {
  let loc = {}; try { loc = JSON.parse(localStorage.getItem(BIZ_KEY)) || {}; } catch { }
  const cfg = window.FIXI_BUSINESS || {}, pick = k => String(loc[k] ?? cfg[k] ?? '').trim();
  return { name: pick('name'), address: pick('address'), tin: pick('tin'), phone: pick('phone'), email: pick('email') };
}
export function saveBizSettings(b) { try { localStorage.setItem(BIZ_KEY, JSON.stringify(b)); } catch { } }
export const bizConfigured = b => !!(b.name && b.address && b.tin);
export const manilaTime = iso => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) + ' (PHT)';
const php = n => '₱' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let libP = null;
function loadLib() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return (libP ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js'; s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { libP = null; rej(new Error('PDF library could not be loaded')); }; document.head.appendChild(s); }));
}
export const CARE = [
  'Wear them 1–2 hours on the first days, then a little longer each day.',
  'Hand-wash with lukewarm water and mild soap; rinse and air-dry.',
  'Keep away from heat: no dryer, direct sun or hot car (TPU softens above 50 °C).',
  'Take them out of your shoes now and then to air out.',
  'If you feel pain, redness or blisters, stop wearing them and visit us for an adjustment.',
  'Diabetes: check your feet every day and see your doctor or podiatrist regularly.'
];
/**
 * d = { receiptNo, date (ISO), customer: {name, phone, email}, items: [{ title, lines: [], qty, unit }], discount, payment: { method, paid },
 *       staffName, notes, logo: dataURL (PNG), logoAspect, biz: bizSettings(), test: bool }
 */
export async function buildReceiptPdf(d) {
  const jsPDF = await loadLib(), F = (await import('./vendor/fonts/receipt-fonts.js')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('fx-r.ttf', F.regular); doc.addFont('fx-r.ttf', 'FX', 'normal');
  doc.addFileToVFS('fx-b.ttf', F.bold); doc.addFont('fx-b.ttf', 'FX', 'bold');
  const W = 210, M = 16, R = W - M, blue = [0, 153, 255], ink = [22, 35, 39], grey = [110, 120, 128];
  const biz = d.biz || {}, official = bizConfigured(biz);
  const font = (st = 'normal', size = 10, col = ink) => { doc.setFont('FX', st); doc.setFontSize(size); doc.setTextColor(...col); };
  let y = 14;
  // header
  if (d.logo) { const h = 13, w = h * (d.logoAspect || 640 / 184); try { doc.addImage(d.logo, 'PNG', M, y, w, h); } catch { } }
  font('bold', 13); doc.text('Fixifoot Philippines', R, y + 4, { align: 'right' });
  font('normal', 8.5, grey);
  const hdr = [biz.name && biz.name !== 'Fixifoot Philippines' ? biz.name : null, biz.address || null, [biz.phone, biz.email].filter(Boolean).join(' · ') || null, 'fixifoot.ph', biz.tin ? 'TIN ' + biz.tin : null].filter(Boolean);
  let hy = y + 9; for (const l of hdr) { for (const s of doc.splitTextToSize(l, 90)) { doc.text(s, R, hy, { align: 'right' }); hy += 3.9; } }
  y = Math.max(y + 18, hy + 2);
  doc.setDrawColor(...blue); doc.setLineWidth(0.8); doc.line(M, y, R, y); y += 9;
  // title
  font('bold', 17); doc.text(official ? 'RECEIPT' : 'ACKNOWLEDGEMENT RECEIPT', M, y);
  if (d.test) { font('bold', 11, [215, 38, 61]); doc.text('TEST – NOT A REAL ORDER', R, y, { align: 'right' }); }
  y += 5; font('normal', 8, grey);
  doc.text(official ? 'Acknowledges payment / order received. Ask us if you need a BIR-registered invoice.' : 'This is not an official receipt (BIR). It acknowledges your order and any payment received.', M, y); y += 8;
  // meta box
  const paid = !!d.payment?.paid;
  const meta = [['Receipt / order no.', d.receiptNo], ['Date', manilaTime(d.date)], ['Payment method', d.payment?.method || '–'], ['Status', paid ? 'PAID' : 'UNPAID']];
  doc.setFillColor(242, 248, 255); doc.roundedRect(M, y - 4.5, R - M, 17, 2, 2, 'F');
  meta.forEach(([k, v], i) => { const x = M + 4 + (i % 2) * 88, yy = y + Math.floor(i / 2) * 7.5; font('normal', 8, grey); doc.text(k, x, yy); font('bold', 10, k === 'Status' ? (paid ? [10, 125, 59] : [192, 57, 43]) : ink); doc.text(String(v), x + 34, yy); });
  y += 20;
  // customer
  font('bold', 10.5); doc.text('Customer', M, y); y += 5.5;
  const cust = [['Name', d.customer?.name], ['Mobile', d.customer?.phone], ['Email', d.customer?.email]];
  cust.forEach(([k, v]) => { font('normal', 9, grey); doc.text(k, M, y); font('normal', 9.5); doc.text(String(v || '–'), M + 22, y); y += 5; });
  y += 4;
  // items table
  const cx = { desc: M + 2, qty: 128, unit: 158, amt: R - 2 };
  doc.setFillColor(...ink); doc.rect(M, y - 4.6, R - M, 7, 'F');
  font('bold', 9, [255, 255, 255]); doc.text('Item', cx.desc, y); doc.text('Qty', cx.qty, y, { align: 'center' }); doc.text('Unit price', cx.unit, y, { align: 'right' }); doc.text('Amount', cx.amt, y, { align: 'right' });
  y += 7.5; let sub = 0;
  for (const it of d.items || []) {
    const amt = (it.unit || 0) * (it.n || 1); sub += amt;
    font('bold', 10); doc.text(doc.splitTextToSize(it.title, 100), cx.desc, y);
    font('normal', 9.5); doc.text(it.qty || '1 pair', cx.qty, y, { align: 'center' }); doc.text(php(it.unit), cx.unit, y, { align: 'right' }); doc.text(php(amt), cx.amt, y, { align: 'right' });
    y += 5; font('normal', 8.6, grey);
    for (const l of it.lines || []) for (const s of doc.splitTextToSize(l, 104)) { doc.text(s, cx.desc + 2, y); y += 4.2; }
    y += 2; doc.setDrawColor(226, 233, 241); doc.setLineWidth(0.3); doc.line(M, y, R, y); y += 5.5;
  }
  // totals
  const disc = Math.max(0, Math.min(+d.discount || 0, sub)), total = sub - disc;
  const trow = (k, v, b) => { font(b ? 'bold' : 'normal', b ? 12 : 9.5, ink); doc.text(k, cx.unit - 32, y, { align: 'left' }); doc.text(v, cx.amt, y, { align: 'right' }); y += b ? 7 : 5.5; };
  trow('Subtotal', php(sub)); trow('Discount', disc ? '− ' + php(disc) : php(0));
  doc.setDrawColor(...ink); doc.setLineWidth(0.4); doc.line(cx.unit - 32, y - 3.4, R, y - 3.4); y += 1.5;
  trow('Total (PHP)', php(total), true);
  y += 2;
  // payment + staff + notes
  font('normal', 9, grey); doc.text('Payment', M, y); font('normal', 9.5); doc.text(`${d.payment?.method || 'Not yet chosen'} · ${paid ? 'Paid' : 'Unpaid – please pay at the counter'}`, M + 22, y); y += 5;
  font('normal', 9, grey); doc.text('Staff', M, y); font('normal', 9.5); doc.text(d.staffName || '–', M + 22, y); y += 5;
  if (d.notes) { font('normal', 9, grey); doc.text('Notes', M, y); font('normal', 9.5); const ns = doc.splitTextToSize(d.notes, R - M - 22); doc.text(ns, M + 22, y); y += ns.length * 4.4 + 1; }
  y += 5;
  // thank you + care
  doc.setFillColor(240, 250, 244); const careH = 12 + CARE.length * 4.6; doc.roundedRect(M, y - 5, R - M, careH, 2, 2, 'F');
  font('bold', 10.5, [10, 125, 59]); doc.text('Thank you for choosing Fixifoot!', M + 4, y); y += 5.5;
  font('bold', 8.8); doc.text('Caring for your TPU insoles', M + 4, y); y += 4.6; font('normal', 8.4);
  for (const c of CARE) { doc.text('•  ' + c, M + 5, y); y += 4.6; }
  // footer
  const fy = 284; doc.setDrawColor(226, 233, 241); doc.setLineWidth(0.3); doc.line(M, fy - 5, R, fy - 5);
  font('bold', 8.5, ink); doc.text('Comfort product, not a medical device.', M, fy);
  font('normal', 7.6, grey); doc.text('If you have diabetes, circulation problems or ongoing pain, please see a doctor or podiatrist.', M, fy + 4);
  doc.text(`${d.receiptNo} · fixifoot.ph`, R, fy, { align: 'right' });
  doc.setProperties({ title: `Fixifoot ${official ? 'Receipt' : 'Acknowledgement Receipt'} ${d.receiptNo}`, subject: 'Fixifoot order receipt', author: 'Fixifoot Philippines', creator: 'Fixifoot app' });
  const blob = doc.output('blob');
  return { blob, name: `Fixifoot-receipt-${d.receiptNo}.pdf`, total, subtotal: sub, discount: disc, official };
}
/**
 * v12 orthotist fitting report. d = { customer: {name, phone}, date, product, staffName, logo, logoAspect, feet: [{ side, approx, measurements: [[k,v]], corrections: [{label, value, rx, overridden, reason}], notes: [] }], disclaimer }
 */
export async function buildFittingPdf(d) {
  const jsPDF = await loadLib(), F = (await import('./vendor/fonts/receipt-fonts.js')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('fx-r.ttf', F.regular); doc.addFont('fx-r.ttf', 'FX', 'normal');
  doc.addFileToVFS('fx-b.ttf', F.bold); doc.addFont('fx-b.ttf', 'FX', 'bold');
  const W = 210, M = 14, R = W - M, blue = [0, 153, 255], ink = [22, 35, 39], grey = [110, 120, 128], red = [192, 57, 43];
  const font = (st = 'normal', size = 10, col = ink) => { doc.setFont('FX', st); doc.setFontSize(size); doc.setTextColor(...col); };
  let y = 14, page = 1;
  const footer = () => { const fy = 286; doc.setDrawColor(226, 233, 241); doc.setLineWidth(0.3); doc.line(M, fy - 5, R, fy - 5);
    font('bold', 7.8, red); doc.text('Starting prescription generated from the scan – must be reviewed and signed off by a licensed orthotist / podiatrist.', M, fy);
    font('normal', 7.4, grey); doc.text(`Fixifoot fitting report · page ${page}`, R, fy + 4, { align: 'right' }); doc.text('Comfort product, not a medical device.', M, fy + 4); };
  const need = h => { if (y + h > 274) { footer(); doc.addPage(); page++; y = 16; } };
  if (d.logo) { const h = 12, w = h * (d.logoAspect || 640 / 184); try { doc.addImage(d.logo, 'PNG', M, y, w, h); } catch { } }
  font('bold', 15); doc.text('Fitting report', R, y + 5, { align: 'right' });
  font('normal', 8.5, grey); doc.text('Orthotist engine v12 · Fixifoot Philippines', R, y + 10, { align: 'right' });
  y += 17; doc.setDrawColor(...blue); doc.setLineWidth(0.8); doc.line(M, y, R, y); y += 7;
  const meta = [['Customer', d.customer?.name || '–'], ['Mobile', d.customer?.phone || '–'], ['Date', manilaTime(d.date)], ['Product', d.product || '–'], ['Staff', d.staffName || '–']];
  meta.forEach(([k, v]) => { font('normal', 9, grey); doc.text(k, M, y); font('bold', 9.5); doc.text(String(v), M + 24, y); y += 5; });
  y += 2;
  for (const f of d.feet || []) {
    need(30);
    doc.setFillColor(...ink); doc.rect(M, y - 5, R - M, 7.5, 'F'); font('bold', 11, [255, 255, 255]); doc.text(f.side + ' foot', M + 3, y);
    if (f.approx) { font('bold', 9.5, [255, 210, 80]); doc.text('APPROX – built from measurements, no 3D scan', R - 3, y, { align: 'right' }); }
    y += 8; font('bold', 10); doc.text('Measurements', M, y); y += 5;
    for (const [k, v] of f.measurements) { need(5); font('normal', 8.8, grey); doc.text(k, M + 2, y); font('normal', 9); const t = doc.splitTextToSize(String(v), R - M - 62); doc.text(t, M + 58, y); y += Math.max(1, t.length) * 4.3; }
    y += 3; need(14); font('bold', 10); doc.text('Corrections', M, y); y += 4;
    doc.setFillColor(236, 242, 248); doc.rect(M, y - 3.6, R - M, 6, 'F'); font('bold', 8.6);
    doc.text('Correction', M + 2, y); doc.text('Value', M + 60, y); doc.text('Reason', M + 86, y); y += 6;
    for (const c of f.corrections) {
      const t = doc.splitTextToSize(c.reason, R - M - 88); need(t.length * 3.9 + 4);
      font('bold', 8.8); doc.text(doc.splitTextToSize(c.label, 56), M + 2, y);
      font('bold', 9, c.overridden ? [180, 90, 0] : ink); doc.text(String(c.value), M + 60, y);
      if (c.overridden) { font('normal', 7.2, [180, 90, 0]); doc.text(`staff (Rx ${c.rx})`, M + 60, y + 3.6); }
      font('normal', 8.2); doc.text(t, M + 86, y); y += Math.max(t.length * 3.9, c.overridden ? 7 : 4) + 2.2;
      doc.setDrawColor(226, 233, 241); doc.setLineWidth(0.2); doc.line(M, y - 1.6, R, y - 1.6); y += 1.4;
    }
    if (f.notes?.length) { y += 1; for (const n of f.notes) { const t = doc.splitTextToSize('•  ' + n, R - M - 4); need(t.length * 4 + 1); font('normal', 8.4, grey); doc.text(t, M + 2, y); y += t.length * 4 + 1; } }
    y += 5;
  }
  const dl = doc.splitTextToSize(d.disclaimer || '', R - M - 8); need(dl.length * 4.2 + 24);
  doc.setFillColor(255, 244, 236); doc.roundedRect(M, y - 5, R - M, dl.length * 4.2 + 12, 2, 2, 'F');
  font('bold', 9.5, red); doc.text('Clinical review required', M + 4, y); y += 5; font('normal', 8.4); doc.text(dl, M + 4, y); y += dl.length * 4.2 + 8;
  font('normal', 9, grey); doc.text('Reviewed by (orthotist / podiatrist): ______________________   Licence no.: __________   Date: __________', M, y);
  footer();
  doc.setProperties({ title: 'Fixifoot fitting report ' + (d.customer?.name || ''), subject: 'Orthotic fitting report', author: 'Fixifoot Philippines', creator: 'Fixifoot app' });
  const safe = String(d.customer?.name || 'customer').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'customer';
  return { blob: doc.output('blob'), name: `Fixifoot-fitting-report-${safe}.pdf` };
}
export function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
export async function shareBlob(blob, name, title) {
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title, text: title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; } }
  downloadBlob(blob, name); return 'downloaded';
}
export function printBlob(blob) {
  const url = URL.createObjectURL(blob);
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { const w = window.open(url, '_blank'); if (!w) location.href = url; return; }
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; f.src = url; document.body.appendChild(f);
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, '_blank'); } setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000); };
}
