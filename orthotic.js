// Fixifoot v12 – "orthotist engine": scan measurements -> per-foot prescription (corrections with reasons) -> insole / footbed params.
// Rules are documented in ORTHOTIC_RULES.md. They are a starting prescription and must be reviewed by a licensed orthotist / podiatrist.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;

// rearfoot (calcaneal) alignment from the aligned raw scan (mm, y-up, heel +z): tilt of the heel bisector seen from behind.
// + = valgus (heel everted, foot rolls in), - = varus. Needs at least ~35 mm of heel/ankle above the floor.
export function rearfootFromMesh(geo, md) {
  try {
    const P = geo.attributes.position, L = md.L, z1 = md.zHeel + 2, z0 = md.zHeel - 0.08 * L; // posterior heel (calcaneus) only, like a clinician's heel bisection
    const lo = [], hi = []; let ymax = 0;
    for (let i = 0; i < P.count; i++) { const z = P.getZ(i); if (z < z0 || z > z1) continue; const y = P.getY(i), x = P.getX(i); if (y > ymax) ymax = y; if (y >= 3 && y <= 12) lo.push(x); else if (y >= 25 && y <= 40) hi.push(x); }
    if (ymax < 32 || lo.length < 40 || hi.length < 40) return null;
    const ctr = a => { a.sort((p, q) => p - q); return (a[Math.floor(a.length * .05)] + a[Math.floor(a.length * .95)]) / 2; };
    const dx = (ctr(hi) - ctr(lo)) * md.medialX, dy = 32.5 - 7.5;
    return r1(Math.atan2(dx, dy) * 180 / Math.PI);
  } catch { return null; }
}

// plantar pressure proxy from the 2 mm height map: share of "contact" cells (plantar surface < 2.5 mm) per region
function contactZones(md) {
  const g = md.grid; if (!g?.raw) return null;
  const { res, x0, z0, nx, nz, raw } = g; let heel = 0, mid = 0, met = 0, hallux = 0, tot = 0;
  for (let j = 0; j < nz; j++) { const z = z0 + (j + .5) * res, u = md.uOfZ(z); if (u < 0 || u > 1) continue; const row = md.rowAt(z), c = (row.lo + row.hi) / 2, hw = Math.max(4, (row.hi - row.lo) / 2);
    for (let i = 0; i < nx; i++) { const v = raw[j * nx + i]; if (isNaN(v) || v > 2.5) continue; const sn = (x0 + (i + .5) * res - c) / hw * md.medialX; tot++;
      if (u < .25) heel++; else if (u < md.ballU - .07) mid++; else if (u < md.ballU + .07) met++; else if (u > md.ballU + .1 && sn > .2) hallux++; } }
  if (!tot) return null;
  return { heel: heel / tot, midfoot: mid / tot, metHeads: met / tot, hallux: hallux / tot };
}

const ARCH_FROM_CSI = csi => csi < 20 ? 'high' : csi <= 45 ? 'normal' : csi <= 60 ? 'low' : 'flat';
// plantar medial-arch apex height as % of foot length (soft-tissue "navicular proxy" from the 2 mm map) – Fixifoot scan thresholds
export const ARCH_FROM_AHI = p => p < 6.5 ? 'flat' : p < 7.8 ? 'low' : p <= 10.5 ? 'normal' : 'high';
const ORDER = ['high', 'normal', 'low', 'flat'];
// 1) measurements for one foot
export function measureFoot(foot, md, opts = {}) {
  const approx = ['self', 'manual'].includes(foot.source) || !foot.map;
  const L = md?.L || foot.length, archH = md?.archH ?? null;
  const m = {
    side: foot.side, source: foot.source, approx, lengthMm: Math.round(foot.length || L), ballWidthMm: Math.round(md?.W || foot.width), heelWidthMm: Math.round(md?.heelW || foot.heelWidth || (foot.width || 95) * .66),
    archHeightMm: archH != null ? r1(archH) : null, archHeightIndex: archH != null ? r1(archH / L * 100) : null, csi: foot.csi ?? md?.csi ?? null,
    archType: null, csiClass: foot.csi != null ? ARCH_FROM_CSI(foot.csi) : null,
    metLineMm: md ? Math.round(md.ballU * L) : Math.round(.72 * L), toeLengthMm: md ? Math.round((1 - md.ballU) * L) : Math.round(.28 * L),
    rearfootDeg: foot.rearfootDeg ?? null, rearfootMethod: foot.rearfootDeg != null ? 'measured from the 3D heel shape' : null,
    pressure: md && !approx ? contactZones(md) : null, peakForefoot: foot.peakForefootPressure ?? null
  };
  // arch type: staff override > arch height index (scan) > CSI / stored class; a very flat footprint (CSI > 60) moves it one step flatter
  if (opts.archOverride) { m.archType = opts.archOverride; m.archMethod = 'staff override'; }
  else if (!approx && m.archHeightIndex != null) { let t = ARCH_FROM_AHI(m.archHeightIndex); if ((foot.csi ?? 0) > 60 && ORDER.indexOf(t) < 3) t = ORDER[ORDER.indexOf(t) + 1]; m.archType = t; m.archMethod = `arch height index ${m.archHeightIndex}% of length${m.csiClass && m.csiClass !== t ? ` (footprint CSI alone says ${m.csiClass})` : ''}`; }
  else { m.archType = foot.archType || ARCH_FROM_CSI(foot.csi ?? 35); m.archMethod = approx ? 'from the entered measurements / questionnaire' : 'footprint (Chippaux-Smirak index)'; }
  if (m.rearfootDeg == null) { m.rearfootDeg = { flat: 6, low: 4, normal: 2, high: -2 }[m.archType] ?? 2; m.rearfootMethod = 'estimated from arch type (no heel geometry)'; m.rearfootEstimated = true; }
  // arch height expected for a "normal" adult foot of this length (~8.5 % of length, plantar soft-tissue apex on the scan)
  m.normalArchMm = r1(0.085 * L);
  return m;
}

// 2) prescription rules -> list of corrections { id, label, value, unit, kind, min, max, step, reason }
export function prescribe(m, ctx = {}) {
  const C = [], kid = ctx.kid || m.lengthMm < 215, dia = !!ctx.diabetic, ff = ctx.kind === 'flipflop' || ctx.kind === 'slide', approx = m.approx;
  const add = (id, label, value, unit, reason, lim = {}) => C.push({ id, label, value, unit, reason, kind: lim.kind || 'num', min: lim.min ?? 0, max: lim.max ?? 99, step: lim.step ?? (unit === '°' ? 1 : 0.5) });
  const why = [];
  // --- arch support (extra height on top of the scanned arch) ---
  let boost = 0, archR;
  const boostMax = dia ? 2 : kid ? 2 : approx ? 2 : 5;
  if (m.archType === 'flat' || m.archType === 'low') {
    const deficit = m.archHeightMm != null ? Math.max(0, m.normalArchMm - m.archHeightMm) : (m.archType === 'flat' ? 6 : 3);
    boost = clamp(r1(deficit * 0.5), m.archType === 'flat' ? 2 : 1, boostMax);
    archR = `${m.archType === 'flat' ? 'Flat' : 'Low'} arch${m.archHeightMm != null ? ` (${m.archHeightMm} mm vs ≈${m.normalArchMm} mm typical)` : ''}: partial correction – half of the deficit, max ${boostMax} mm${dia ? ' (diabetes: accommodative, not corrective)' : kid ? ' (child: flexible foot, gentle)' : approx ? ' (no scan: conservative)' : ''}. Assumes a flexible flat foot – reduce to ≤1.5 mm if the arch is rigid.`;
  } else if (m.archType === 'high') { boost = 0; archR = 'High arch: total contact fills the arch to spread load (cavus feet overload heel and forefoot); no extra lift.'; }
  else archR = 'Normal arch: total contact with the scanned arch, no extra lift.';
  add('archBoost', 'Arch support (extra height)', boost, 'mm', archR, { min: 0, max: dia || kid ? 3 : 8 });
  add('archFill', 'Arch contact fill', m.archType === 'high' ? 100 : dia ? 95 : 100, '%', m.archType === 'high' ? 'Full contact under the high arch.' : dia ? 'Diabetes: 95 % fill keeps the arch slightly relieved – no hard pressure under the midfoot.' : 'Full total contact.', { min: 60, max: 100, step: 5 });
  // --- heel cup ---
  let cup = Math.round(m.lengthMm * (m.archType === 'flat' || m.rearfootDeg > 4 ? .065 : .05));
  let cupR = m.archType === 'flat' || m.rearfootDeg > 4 ? 'Pronation / flat foot: deeper heel cup holds the heel fat pad and controls rearfoot eversion (≈6.5 % of foot length).' : 'Standard heel cup ≈5 % of foot length – centres the heel and keeps the fat pad under the calcaneus.';
  const cupMax = ff ? 10 : kid ? 12 : 18; cup = clamp(cup, 8, cupMax); if (ff) cupR += ' Flip-flop footbed: max 10 mm.'; if (kid) cupR += ' Child: max 12 mm.';
  add('heelCupDepth', 'Heel cup depth', cup, 'mm', cupR, { min: 6, max: ff ? 12 : 22 });
  // --- rearfoot posting ---
  const postMax = dia ? 2 : kid ? 3 : ff ? 4 : approx || m.rearfootEstimated ? 3 : 6;
  let mp = 0, lw = 0, pR, lR;
  if (m.rearfootDeg > 4) { mp = clamp(Math.round(m.rearfootDeg - 2), 2, postMax); pR = `Heel valgus ≈${m.rearfootDeg}° (${m.rearfootMethod}); normal resting stance 0–4°. Medial rearfoot post ${mp}° ≈ (valgus − 2°), capped at ${postMax}°.`; }
  else if (m.archType === 'flat' && !dia) { mp = Math.min(2, postMax); pR = `Flat arch with heel ≈${m.rearfootDeg}°: light 2° medial post for pronation control.`; }
  else pR = `Heel alignment ≈${m.rearfootDeg}° (${m.rearfootMethod}) – within 0–4°, no medial post.`;
  if (m.rearfootDeg < -2 || (m.archType === 'high' && m.rearfootDeg < 0)) { lw = clamp(Math.round(-m.rearfootDeg + 1), 2, Math.min(postMax, 5)); lR = `Heel varus ≈${m.rearfootDeg}° / high arch: lateral wedge ${lw}° counters supination (rolling outward, ankle sprains).`; if (mp) { mp = 0; } }
  else lR = 'No supination – no lateral wedge.';
  const has = (...ids) => ctx.conditions?.some(c => ids.includes(c));
  if (!lw && has('overpronation', 'pttd') && mp < Math.min(3, postMax)) { mp = Math.min(3, postMax); pR += ` Over-pronation / flat-foot problem selected: post raised to ${mp}°.`; }
  if (!mp && !lw && has('supination', 'ankle_instability', 'pes_cavus') && !dia) { lw = Math.min(3, postMax); lR = `Supination / ankle instability / high-arch problem selected: ${lw}° lateral wedge (Kirby rearfoot posting range).`; }
  if (dia && (mp || lw)) { pR += ' Diabetes: posting limited to 2°.'; }
  add('medialPost', 'Medial rearfoot post', mp, '°', pR, { min: 0, max: 8 });
  add('lateralWedge', 'Lateral wedge', lw, '°', lR, { min: 0, max: 6 });
  // --- metatarsal pad / forefoot relief ---
  const ffLoad = m.pressure ? m.pressure.metHeads : null, hallux = m.pressure ? m.pressure.hallux : null;
  const ffLim = m.archType === 'high' ? .5 : .55; // typical feet on the scan map: ~45–49 % of contact under the met heads
  const metNeed = (ffLoad != null && ffLoad > ffLim) || ctx.conditions?.some(c => ['metatarsalgia', 'mortons_neuroma', 'calluses', 'sesamoiditis'].includes(c));
  const metPad = metNeed && !dia && !kid;
  add('metPad', 'Metatarsal pad', metPad ? 1 : 0, '', metPad ? `Forefoot load high${ffLoad != null ? ` (${Math.round(ffLoad * 100)} % of contact under the met heads)` : ''}: dome placed just behind the met-head line (${m.metLineMm} mm from the heel) lifts the metatarsal shafts and unloads the heads.` : dia ? 'Diabetes: no firm pad – forefoot pressure is relieved with soft offload pockets instead.' : kid ? 'Child: no metatarsal pad unless symptoms.' : 'Forefoot load normal – no metatarsal pad.', { kind: 'bool', max: 1, step: 1 });
  const relief = dia || (hallux != null && hallux > .12) || ctx.conditions?.some(c => ['hallux_rigidus', 'bunion'].includes(c));
  add('forefootRelief', 'Forefoot / hallux relief', relief ? 1 : 0, '', dia ? 'Diabetes: soft relief pockets under heel, met heads and hallux (pressure offloading).' : relief ? `Hallux / 1st MTP pressure${hallux != null ? ` (${Math.round(hallux * 100)} % of contact)` : ''}: 1 mm relief under the big-toe joint.` : 'No forefoot relief needed.', { kind: 'bool', max: 1, step: 1 });
  // --- heel lift (leg-length difference, questionnaire) ---
  const lld = Math.max(0, +ctx.lldMm || 0), shorter = ctx.lldSide ? ctx.lldSide[0].toUpperCase() : null;
  let lift = 0, liftR = 'No leg-length difference reported – no heel lift.';
  if (lld && shorter) {
    if (shorter !== m.side) liftR = `Leg-length difference ${lld} mm on the ${shorter === 'L' ? 'left' : 'right'} – lift goes on the other (shorter) side only.`;
    else if (lld < 4) liftR = `Leg-length difference ${lld} mm: under 4 mm usually not corrected (staff may add if symptomatic).`;
    else { lift = Math.min(lld, ff ? 8 : 6); liftR = `Shorter leg, difference ${lld} mm: heel lift ${lift} mm${lld > lift ? ` (capped – the remaining ${lld - lift} mm should go into the shoe / sole)` : ''}.`; }
  }
  add('heelLift', 'Heel lift', lift, 'mm', liftR, { min: 0, max: ff ? 10 : 8 });
  if (ctx.footDiffMm != null && ctx.footDiffMm >= 5) why.push(`Left/right foot length differ by ${ctx.footDiffMm} mm – each insole is sized to its own foot (this is not a leg-length difference).`);
  // --- material / top ---
  add('softTop', 'Soft top / no hard edges', dia ? 1 : 0, '', dia ? 'Diabetes: softer top layer, rounded edges, no aggressive posting (IWGDF footwear guidance).' : 'Standard top.', { kind: 'bool', max: 1, step: 1 });
  if (approx) why.push('No 3D scan: conservative defaults (posting ≤3°, arch lift ≤2 mm). APPROX – rescan recommended.');
  if (kid) why.push('Child foot (<215 mm or Kids model): gentle limits (arch ≤2 mm extra, post ≤3°, cup ≤12 mm). Flexible flat feet in children often need no correction – review with a podiatrist.');
  if (dia) why.push('Diabetes: accommodative insole – review by a podiatrist; check feet daily.');
  return { corrections: C, notes: why };
}

// 3) apply (with staff overrides) to the combine() params
export function applyCorrections(p, corr, over = {}) {
  const v = id => { const c = corr.find(x => x.id === id); if (!c) return undefined; return over[id] != null ? over[id] : c.value; };
  p.archBoost = v('archBoost') || 0;
  p.archFill = v('archFill') ?? p.archFill;
  p.heelCupDepth = v('heelCupDepth') ?? p.heelCupDepth;
  p.medialPost = v('medialPost') || 0; p.lateralWedge = v('lateralWedge') || 0; if (p.medialPost) p.lateralWedge = 0;
  if (!p.medialPost) p.medialHeelSkive = 0;
  p.metPad = v('metPad') ? (p.metPad || 'standard') : null;
  if (v('forefootRelief')) { if (v('softTop')) p.offloadPockets = true; else p.firstMTPRelief = true; } else { p.firstMTPRelief = false; if (!v('softTop')) p.offloadPockets = false; }
  p.heelLift = v('heelLift') || 0;
  if (v('softTop')) { p.noHardEdges = true; p.offloadPockets = true; }
  return p;
}
