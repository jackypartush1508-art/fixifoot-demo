/* =====================================================================
   Fixifoot rule engine  (DEMO - edit freely)
   ---------------------------------------------------------------------
   Everything that decides "which support goes into the insole" lives in
   this file, as plain data + one combine() function.

   - ARCH_TYPES : base settings per arch classification
   - ZONES      : named areas on the insole (used for 3D highlights)
   - CONDITIONS : foot problems -> modifications (+ zones to highlight)
   - combine()  : merges arch base + all selected conditions, resolves
                  conflicts (e.g. diabetic overrides firmness/posting).

   Coordinates for ZONES: u = 0 heel ... 1 toe tip (along the foot)
                          s = -1 lateral (outside) ... +1 medial (inside)
   Units: mm for heights/depths, degrees for posts/wedges.
   NOT medical advice - comfort product logic for a sales demo.
   ===================================================================== */
(function (global) {
  'use strict';

  const SHORE_ORDER = ['85A', '90A', '95A'];

  /* ---------------- Arch types (base settings) ---------------- */
  const ARCH_TYPES = {
    high: {
      label: 'High arch (pes cavus)',
      short: 'High arch',
      explain: 'Your arch sits high, so only the heel and ball of the foot carry the load. That concentrates pressure and absorbs shock poorly.',
      base: { archHeight: 20, lateralSupport: 4, heelCupDepth: 14, medialPost: 0, lateralWedge: 0, shore: '85A', fullContact: true, shockAbsorb: true, topCover: 3 },
      notes: ['Full-contact arch fill spreads pressure from heel and forefoot.', 'Soft 85A-90A for cushioning.']
    },
    normal: {
      label: 'Normal arch',
      short: 'Normal',
      explain: 'Your arch is in the typical range. A neutral, comfortable support keeps it that way.',
      base: { archHeight: 15, lateralSupport: 2, heelCupDepth: 12, medialPost: 0, lateralWedge: 0, shore: '90A', fullContact: false, shockAbsorb: false, topCover: 2 },
      notes: ['Neutral support, medium 90A.']
    },
    low: {
      label: 'Low arch',
      short: 'Low arch',
      explain: 'Your arch is lower than average and tends to collapse a little when you stand or walk.',
      base: { archHeight: 12, lateralSupport: 1, heelCupDepth: 14, medialPost: 2, lateralWedge: 0, shore: '90A', fullContact: false, shockAbsorb: false, topCover: 2 },
      notes: ['Moderate medial arch support, 90A.']
    },
    flat: {
      label: 'Flat foot (pes planus)',
      short: 'Flat foot',
      explain: 'The arch is almost fully on the ground. The foot rolls inward (overpronates), which can tire the feet, knees and back.',
      base: { archHeight: 10, lateralSupport: 0, heelCupDepth: 16, medialPost: 4, lateralWedge: 0, shore: '95A', fullContact: false, shockAbsorb: false, topCover: 2 },
      notes: ['Flat foot: control comes from the 4° medial heel post + deep heel cup and a firmer 95A shell; the arch itself is kept moderate (10 mm) so a flat foot is supported, not forced up.']
    }
  };

  /* ---------------- Zones (for 3D highlighting) ----------------
     rect:    { u:[from,to], s:[from,to] }
     ellipse: { cu, cs, ru, rs }                                   */
  const ZONES = {
    heel:        { label: 'Heel cup',            color: '#2f80ed', rect: { u: [0, 0.24], s: [-1, 1] } },
    heelCenter:  { label: 'Heel spur pocket',    color: '#eb5757', ellipse: { cu: 0.12, cs: 0.0, ru: 0.07, rs: 0.45 } },
    heelLift:    { label: 'Heel lift',           color: '#9b51e0', rect: { u: [0, 0.32], s: [-1, 1] } },
    medialHeel:  { label: 'Medial heel post',    color: '#f2994a', rect: { u: [0, 0.28], s: [0.15, 1] } },
    medialArch:  { label: 'Medial arch',         color: '#27ae60', rect: { u: [0.25, 0.58], s: [0.05, 1] } },
    lateralArch: { label: 'Lateral support',     color: '#56ccf2', rect: { u: [0.25, 0.65], s: [-1, -0.45] } },
    lateralEdge: { label: 'Lateral flange',      color: '#2d9cdb', rect: { u: [0.04, 0.7], s: [-1, -0.72] } },
    metPad:      { label: 'Metatarsal pad',      color: '#f2c94c', ellipse: { cu: 0.655, cs: 0.05, ru: 0.05, rs: 0.33 } },
    neuromaPad:  { label: 'Neuroma pad (3rd-4th)', color: '#f2c94c', ellipse: { cu: 0.61, cs: -0.22, ru: 0.05, rs: 0.22 } },
    metHeads:    { label: 'Ball of foot',        color: '#eb5757', rect: { u: [0.68, 0.80], s: [-0.85, 0.85] } },
    firstMTP:    { label: 'Big-toe joint relief', color: '#bb6bd9', ellipse: { cu: 0.73, cs: 0.72, ru: 0.07, rs: 0.32 } },
    sesamoid:    { label: "Dancer's pad cutout", color: '#eb5757', ellipse: { cu: 0.70, cs: 0.58, ru: 0.045, rs: 0.25 } },
    hallux:      { label: "Morton's extension",  color: '#6fcf97', rect: { u: [0.68, 1], s: [0.3, 1] } },
    toeCrest:    { label: 'Toe crest',           color: '#f2994a', rect: { u: [0.79, 0.86], s: [-0.7, 0.55] } },
    forefoot:    { label: 'Wide forefoot',       color: '#bb6bd9', rect: { u: [0.6, 1], s: [-1, 1] } },
    rocker:      { label: 'Rocker / toe spring', color: '#9b51e0', rect: { u: [0.66, 1], s: [-1, 1] } },
    fullLength:  { label: 'Full-length cushion', color: '#56ccf2', rect: { u: [0, 1], s: [-1, 1] } }
  };

  /* ---------------- Conditions -> modifications ----------------
     mods: numbers are "at least this much" (max wins),
           booleans are switched on, 'shore' is a preference:
           'soft' (85A), 'medium' (90A), 'firm' (95A), 'forceSoft' (diabetic).
     group is used to arrange the questionnaire.                    */
  const CONDITIONS = [
    // Heel
    { id: 'plantar_fasciitis', group: 'Heel', name: 'Plantar fasciitis / heel spur',
      signs: 'Sharp heel pain, worst with the first steps in the morning.',
      explain: 'The thick band under the foot is irritated where it attaches to the heel. A deep heel cup, soft heel pocket and arch support take strain off it.',
      mods: { heelCupDepth: 18, heelCushion: true, heelCutout: true, archHeight: 15, shore: 'medium' },
      zones: ['heel', 'heelCenter', 'medialArch'] },
    { id: 'achilles', group: 'Heel', name: "Achilles tendinitis / Sever's disease",
      signs: 'Pain at the back of the heel or above it; children: heel pain during growth spurts.',
      explain: 'A small heel lift shortens the strain on the Achilles tendon while it heals.',
      mods: { heelLift: 6, heelCushion: true },
      zones: ['heelLift'] },

    // Forefoot
    { id: 'metatarsalgia', group: 'Forefoot', name: 'Metatarsalgia (ball-of-foot pain)',
      signs: 'Burning or aching under the ball of the foot.',
      explain: 'A metatarsal dome placed just behind the painful area spreads the bones and moves pressure off them.',
      mods: { metPad: 'central', shore: 'soft' },
      zones: ['metPad', 'metHeads'] },
    { id: 'mortons_neuroma', group: 'Forefoot', name: "Morton's neuroma",
      signs: 'Burning, tingling or numbness between the 3rd and 4th toes; feels like a pebble.',
      explain: 'A pad just behind the 3rd-4th metatarsal heads opens the space around the nerve. Needs a wide toe box.',
      mods: { metPad: 'neuroma', forefootExtraWidth: 3, shore: 'soft' },
      zones: ['neuromaPad', 'forefoot'] },
    { id: 'bunion', group: 'Forefoot', name: 'Hallux valgus / bunion',
      signs: 'Bump at the big-toe joint, big toe leans towards the other toes.',
      explain: 'A wider forefoot and a soft relief at the big-toe joint reduce rubbing and pressure.',
      mods: { forefootExtraWidth: 4, firstMTPRelief: true, archHeight: 13 },
      zones: ['firstMTP', 'forefoot'] },
    { id: 'hallux_rigidus', group: 'Forefoot', name: 'Hallux rigidus (stiff big toe)',
      signs: 'Stiff, painful big-toe joint; hard to push off.',
      explain: "A stiff plate under the big toe (Morton's extension) and a rocker shape let you roll over the toe without bending it.",
      mods: { mortonExtension: true, rocker: true, shore: 'firm' },
      zones: ['hallux', 'rocker'] },
    { id: 'sesamoiditis', group: 'Forefoot', name: 'Sesamoiditis',
      signs: 'Pain under the big-toe joint, common in dancers and runners.',
      explain: "A dancer's pad cutout floats the small bones under the big-toe joint so they don't take the load.",
      mods: { sesamoidCutout: true, shore: 'soft' },
      zones: ['sesamoid'] },

    // Toes
    { id: 'hammer_toes', group: 'Toes', name: 'Hammer / claw toes',
      signs: 'Toes bent at the middle joint, corns on top of toes.',
      explain: 'A toe crest (ridge under the toes) supports them and a soft top cover protects them.',
      mods: { toeCrest: true, topCover: 3, shore: 'soft' },
      zones: ['toeCrest'] },

    // Alignment
    { id: 'overpronation', group: 'Alignment', name: 'Overpronation (foot rolls inward)',
      signs: 'Shoes wear on the inner side; ankles roll in.',
      explain: 'A medial post and firmer inner side stop the foot rolling in too far.',
      mods: { medialPost: 4, archHeight: 16, shore: 'firm' },
      zones: ['medialHeel', 'medialArch'] },
    { id: 'supination', group: 'Alignment', name: 'Supination / underpronation (rolls outward)',
      signs: 'Shoes wear on the outer edge; frequent ankle rolls.',
      explain: 'A lateral wedge and extra cushioning balance the foot and absorb shock.',
      mods: { lateralWedge: 3, lateralSupport: 4, shockAbsorb: true, shore: 'soft' },
      zones: ['lateralArch', 'lateralEdge'] },
    { id: 'pttd', group: 'Alignment', name: 'Flat foot / PTTD (tendon weakness)',
      signs: 'Arch flattening over time, pain on the inner ankle.',
      explain: 'Strong medial arch support plus a medial heel skive take the load off the tibialis posterior tendon.',
      mods: { archHeight: 18, medialHeelSkive: 4, medialPost: 4, heelCupDepth: 16, shore: 'firm' },
      zones: ['medialArch', 'medialHeel', 'heel'] },
    { id: 'pes_cavus', group: 'Alignment', name: 'High arch / pes cavus',
      signs: 'Very high arch, pressure only on heel and ball, frequent ankle rolls.',
      explain: 'Full-contact arch fill, cushioning and a lateral flare spread pressure and add stability.',
      mods: { fullContact: true, lateralFlare: true, lateralSupport: 5, shockAbsorb: true, shore: 'soft' },
      zones: ['medialArch', 'lateralArch', 'fullLength'] },
    { id: 'ankle_instability', group: 'Alignment', name: 'Ankle instability / sprains',
      signs: 'Ankle gives way, repeated sprains.',
      explain: 'A lateral flange and deep heel cup hold the heel centred and resist rolling outward.',
      mods: { lateralFlange: true, heelCupDepth: 20, lateralWedge: 2 },
      zones: ['lateralEdge', 'heel'] },
    { id: 'leg_length', group: 'Alignment', name: 'Leg length difference',
      signs: 'One leg shorter; hip or back pain on one side, uneven shoe wear.',
      explain: 'A lift (up to about 6 mm inside an insole) under the shorter leg evens out the hips. Larger differences go into the sole.',
      mods: { heelLift: 'llD' }, // amount comes from the questionnaire (mm)
      zones: ['heelLift'] },
    { id: 'joint_pain', group: 'Alignment', name: 'Knee / hip / lower back pain',
      signs: 'Pain that gets worse with long walking or standing.',
      explain: 'Better alignment from the arch support plus shock absorption reduces load travelling up the leg.',
      mods: { shockAbsorb: true, archHeight: 13, heelCushion: true },
      zones: ['medialArch', 'heel', 'fullLength'] },

    // Medical / skin
    { id: 'diabetic', group: 'Medical', name: 'Diabetic foot / neuropathy',
      signs: 'Diabetes, numbness, tingling, slow-healing spots.',
      explain: 'Soft 85A full-contact insole with offloading pockets, no seams or hard edges. Always checked by a clinician.',
      mods: { shore: 'forceSoft', fullContact: true, noHardEdges: true, offloadPockets: true, topCover: 4, referClinician: true },
      zones: ['fullLength', 'metHeads', 'heelCenter'] },
    { id: 'calluses', group: 'Medical', name: 'Calluses / pressure points',
      signs: 'Hard skin or red spots in the same places (seen as hot spots on the scan).',
      explain: 'Soft offloading cutouts under the hot spots on the pressure map take load off the skin.',
      mods: { offloadPockets: true, topCover: 3 },
      zones: ['metHeads', 'heelCenter'] },
    { id: 'arthritis', group: 'Medical', name: 'Arthritis (foot / ankle)',
      signs: 'Stiff, swollen, painful joints.',
      explain: 'Soft cushioning plus a rocker shape reduce joint movement and impact.',
      mods: { shore: 'soft', rocker: true, shockAbsorb: true, topCover: 3 },
      zones: ['fullLength', 'rocker'] },

    // Lifestyle
    { id: 'standing_worker', group: 'Lifestyle', name: 'Standing all day (workers)',
      signs: '8+ hours on your feet (retail, nurses, factory, security).',
      explain: 'Extra shock absorption and a cushioned top layer reduce end-of-day fatigue.',
      mods: { shockAbsorb: true, topCover: 3 },
      zones: ['fullLength'] },
    { id: 'athlete', group: 'Lifestyle', name: 'Athlete / runner',
      signs: 'Regular running, court or gym sports.',
      explain: 'Shock absorption in heel and forefoot plus a stable heel cup.',
      mods: { shockAbsorb: true, heelCupDepth: 14 },
      zones: ['heel', 'metHeads'] }
  ];

  /* ---------------- Questionnaire -> automatic conditions ---------------- */
  function autoConditionsFromAnswers(a) {
    const ids = [];
    if (a.diabetes === 'yes') ids.push('diabetic');
    if (a.heelPain === 'yes') ids.push('plantar_fasciitis');
    if (a.jointPain === 'yes') ids.push('joint_pain');
    if (a.standing === '8+') ids.push('standing_worker');
    if (a.activity === 'athlete') ids.push('athlete');
    return ids;
  }

  /* ---------------- Scan -> suggested conditions ---------------- */
  function suggestFromScan(scan) {
    const ids = [];
    if (!scan) return ids;
    if (scan.archType === 'flat') ids.push('overpronation', 'pttd');
    if (scan.archType === 'low') ids.push('overpronation');
    if (scan.archType === 'high') ids.push('pes_cavus', 'supination');
    if (scan.peakForefootPressure > 0.85) ids.push('calluses');
    return ids;
  }

  /* ---------------- combine(): the actual engine ---------------- */
  function combine(archType, conditionIds, answers) {
    answers = answers || {};
    const arch = ARCH_TYPES[archType] || ARCH_TYPES.normal;
    const p = Object.assign({
      archHeight: 12, lateralSupport: 0, heelCupDepth: 12, heelLift: 0,
      medialPost: 0, medialHeelSkive: 0, lateralWedge: 0,
      forefootExtraWidth: 0, topCover: 2, shore: '90A',
      heelCushion: false, heelCutout: false, metPad: null, archFill: 100, mortonExtension: false,
      rocker: false, firstMTPRelief: false, sesamoidCutout: false, toeCrest: false,
      lateralFlange: false, lateralFlare: false, fullContact: false, shockAbsorb: false,
      offloadPockets: false, noHardEdges: false, referClinician: false
    }, JSON.parse(JSON.stringify(arch.base)));

    const notes = arch.notes.slice();
    const conflicts = [];
    const zoneSet = {};
    const shorePrefs = [];
    const has = id => conditionIds.includes(id);
    const conds = CONDITIONS.filter(c => conditionIds.includes(c.id));

    // arch zones
    zoneSet.medialArch = ['Arch type: ' + arch.short];
    if (p.medialPost > 0) (zoneSet.medialHeel = zoneSet.medialHeel || []).push('Arch type: ' + arch.short);
    if (p.fullContact) (zoneSet.lateralArch = zoneSet.lateralArch || []).push('Arch type: ' + arch.short);

    for (const c of conds) {
      for (const [k, v] of Object.entries(c.mods)) {
        if (k === 'shore') { shorePrefs.push({ pref: v, by: c.name }); continue; }
        if (k === 'heelLift' && v === 'llD') {
          const mm = Math.max(0, Number(answers.lldMm || 0));
          p.heelLift = Math.max(p.heelLift, mm);
          if (mm > 6) notes.push(`Leg length: ${mm} mm requested; insole capped at 6 mm, the rest (${mm - 6} mm) goes into the sole of the flip-flop/shoe.`);
          notes.push('Leg-length lift goes ONLY on the shorter leg' + (answers.lldSide ? ` (${answers.lldSide}).` : '.'));
          continue;
        }
        if (typeof v === 'number') p[k] = Math.max(p[k] || 0, v);
        else if (typeof v === 'boolean') p[k] = p[k] || v;
        else if (k === 'metPad') {
          if (p.metPad && p.metPad !== v) { notes.push('Metatarsal pad: neuroma position used (also helps general ball-of-foot pain).'); p.metPad = 'neuroma'; }
          else p.metPad = v;
        } else p[k] = v;
      }
      for (const z of c.zones) (zoneSet[z] = zoneSet[z] || []).push(c.name);
    }

    // Body weight: heavier users need a slightly firmer shell
    if (answers.weight === '90+') { shorePrefs.push({ pref: 'firmer', by: 'Body weight 90 kg+' }); notes.push('Body weight 90 kg+: shell +1 mm thicker.'); }

    /* ---- Conflict 1: medial post vs lateral wedge ---- */
    if (p.medialPost > 0 && p.lateralWedge > 0) {
      const keepMedial = ['flat', 'low'].includes(archType) || has('overpronation') || has('pttd');
      if (keepMedial) { conflicts.push('Medial post and lateral wedge both requested: kept the medial post (foot rolls inward), dropped the lateral wedge.' + (p.lateralFlange && !has('diabetic') ? ' Lateral flange still keeps the ankle stable.' : '')); p.lateralWedge = 0; }
      else { conflicts.push('Medial post and lateral wedge both requested: kept the lateral wedge (foot rolls outward), dropped the medial post.'); p.medialPost = 0; p.medialHeelSkive = 0; }
    }

    /* ---- Conflict 2: shore hardness ---- */
    const prefSet = shorePrefs.map(s => s.pref);
    let idx = SHORE_ORDER.indexOf(p.shore);
    if (prefSet.includes('firm') && prefSet.includes('soft')) {
      idx = 1;
      p.dualDensity = true;
      conflicts.push('Firm and soft requested by different problems: 90A shell with a soft top layer (dual density suggestion).');
    } else if (prefSet.includes('firm')) idx = 2;
    else if (prefSet.includes('soft')) idx = Math.max(0, idx - 1);      // one step softer
    else if (prefSet.includes('medium')) idx = Math.max(idx, 1);        // at least 90A
    if (prefSet.includes('firmer')) idx = Math.min(2, idx + 1);
    p.shore = SHORE_ORDER[idx];

    /* ---- Conflict 3: arthritis prefers softer ---- */
    if (has('arthritis') && p.shore === '95A') { p.shore = '90A'; conflicts.push('Arthritis: firmness reduced from 95A to 90A.'); }

    /* ---- Override: diabetic foot / neuropathy (always wins) ---- */
    if (has('diabetic')) {
      const removed = [];
      if (p.medialPost) removed.push('medial post');
      if (p.medialHeelSkive) removed.push('medial heel skive');
      if (p.lateralWedge) removed.push('lateral wedge');
      if (p.heelCutout) removed.push('heel cutout (replaced by soft offload pocket)');
      if (p.mortonExtension) removed.push("rigid Morton's extension");
      if (p.lateralFlange) removed.push('lateral flange edge');
      p.medialPost = 0; p.medialHeelSkive = 0; p.lateralWedge = 0; p.heelCutout = false; p.mortonExtension = false; p.lateralFlange = false;
      p.archHeight = Math.min(16, Math.max(10, p.archHeight)); // total contact: arch filled to follow the foot, never a hard high point
      p.minThick = 6.4; // >= 1/4" total thickness of cushioning material
      p.shore = '85A'; p.dualDensity = false; p.fullContact = true; p.noHardEdges = true; p.offloadPockets = true; p.referClinician = true;
      p.topCover = Math.max(p.topCover, 4);
      if (removed.length) conflicts.push('Diabetic foot overrides: removed ' + removed.join(', ') + '. Soft 85A, full contact, no hard edges.');
      else conflicts.push('Diabetic foot: soft 85A, full contact, rounded edges, offloading pockets.');
      delete zoneSet.medialHeel; delete zoneSet.hallux; delete zoneSet.lateralEdge;
      for (let i = notes.length - 1; i >= 0; i--) if (/post|95A/.test(notes[i])) notes.splice(i, 1);
      notes.unshift('Diabetic: soft 85A full-contact, integrated gentle arch, offloading pockets, rounded edges.');
    }

    /* ---- Caps / safety limits ---- */
    if (p.heelLift > 6) p.heelLift = 6;
    p.medialPost = Math.min(p.medialPost, 6); p.lateralWedge = Math.min(p.lateralWedge, 5); p.medialHeelSkive = Math.min(p.medialHeelSkive, 4);
    if (p.heelLift > 0) notes.push('Heel lift: first-time users usually start at ~50% of the measured difference and build up.');
    p.heelCupDepth = Math.min(p.heelCupDepth, 22);
    p.archHeight = Math.min(p.archHeight, 22);
    // a flat / low foot is supported, not forced up: the control comes from posting + heel cup
    const archCap = { flat: 14, low: 16 }[archType];
    if (archCap && p.archHeight > archCap) { notes.push(`Arch limited to ${archCap} mm for a ${archType === 'flat' ? 'flat' : 'low-arched'} foot (requested ${p.archHeight} mm) – control comes from the medial post/skive and heel cup; raise gradually at follow-up if tolerated.`); p.archHeight = archCap; }
    // total contact from a scan: how much of the scanned arch height is filled (100% = full contact)
    if (has('arthritis')) p.archFill = 90; else if (has('plantar_fasciitis') && archType === 'high') p.archFill = 95;
    if (has('diabetic')) p.archFill = 100;
    if (p.heelLift > 0 && !zoneSet.heelLift) zoneSet.heelLift = ['Heel lift'];
    if (p.medialPost === 0) delete zoneSet.medialHeel;
    if (p.offloadPockets && !zoneSet.metHeads) zoneSet.metHeads = ['Offloading'];

    if (p.shockAbsorb) notes.push('Shock absorption: gyroid infill 15-20% in heel and forefoot.');
    if (p.rocker) notes.push('Rocker: fully effective when built into the flip-flop / slide sole.');
    if (p.referClinician) notes.push('Recommend a check by a podiatrist / doctor before and after fitting.');
    if (has('mortons_neuroma') || has('bunion')) notes.push('Choose footwear with a wide toe box.');

    // infill suggestion from shore
    p.infill = { '85A': 'Gyroid 15%', '90A': 'Gyroid 20%', '95A': 'Gyroid 25%' }[p.shore];

    const zones = Object.entries(zoneSet).filter(([id]) => ZONES[id]).map(([id, reasons]) => ({ id, ...ZONES[id], reasons }));
    return { archType, params: p, notes, conflicts, zones, conditions: conds.map(c => c.id) };
  }


  /* ---------------- Clinical rationale (staff panel) ----------------
     Plain-words explanation of every modification with the source it is based on. */
  const REFS = {
    rootHC: { short: 'KevinRoot Medical – heel cup depth guide', url: 'https://www.kevinrootmedical.com/pages/clinic-guide-heel-cup-depth' },
    nwRx: { short: 'Northwest Podiatric Lab – Rx guide (posting, heel lift)', url: 'https://nwpodiatric.com/rxguide/' },
    pacRx: { short: 'Pacific Orthotic Lab – standard Rx form (heel cup 10/14/18 mm, 4°/4° post)', url: 'https://www.pacificorthotic.com/wp-content/uploads/2024/01/RX-Form-Web-STANDARD-Jan-2024.pdf' },
    hastings: { short: 'Hastings et al. 2007, Foot Ankle Int – met pad 6–11 mm proximal to met heads', url: 'https://pubmed.ncbi.nlm.nih.gov/17257544/' },
    lli: { short: 'Cochrane review 2021 – shoe & heel lifts (>10 mm → external)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8651068/' },
    ohi: { short: 'OHI – heel raise (max 10 mm, first time ≤50%)', url: 'http://www.ohiinternational.com/products/orthotics/modifications/heel-raise.html' },
    iwgdf: { short: 'IWGDF 2023 guidelines – diabetic footwear / insoles', url: 'https://iwgdfguidelines.org/wp-content/uploads/2023/07/IWGDF-Guidelines-2023.pdf' },
    cms: { short: 'CMS LCD L33369 / A52501 – diabetic inserts: total contact, ≥1/4" (6.4 mm)', url: 'https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=33369' },
    podLec: { short: 'Podiatry.com lecture – writing orthotic prescriptions (met pads under heads 2–4)', url: 'https://www.podiatry.com/lecturehall/transcription/5702' }
  };
  function rationale(res, opts) {
    opts = opts || {};
    const p = res.params, a = ARCH_TYPES[res.archType] || ARCH_TYPES.normal, out = [];
    const add = (title, value, why, refs) => out.push({ title, value, why, refs: (refs || []).map(r => REFS[r]).filter(Boolean) });
    if (opts.totalContact) add('Total-contact top surface', 'full length, 2 mm map', 'The top of the insole is the customer\'s own scanned sole – heel, arch, forefoot and toe sulcus – measured on a 2 mm grid. Clinical changes (posts, pads, heel cup) are added on top of that surface. Contact over the whole sole spreads the load, so no single spot is overloaded.', ['iwgdf']);
    if (opts.totalContact && opts.scanArchH != null) add('Arch support', `scanned arch ${opts.scanArchH} mm, filled ${p.archFill}%`,
      `${a.short}: the arch height comes from the scan itself, not from a standard size. ${p.archFill < 100 ? `It is filled to ${p.archFill}% so the arch is supported without pressing into it (${p.archFill <= 90 ? 'sensitive / stiff joints' : 'tender plantar fascia'}).` : 'It is filled 100% so the arch shares the load that would otherwise sit only on the heel and ball of the foot.'} Staff can change the fill in the dashboard.`, ['podLec', 'iwgdf']);
    else add('Arch support', p.archHeight + ' mm, peak at ~41% of foot length from the heel',
      `${a.short}: ${{ high: 'the arch is filled fully so it shares the load that otherwise sits only on the heel and ball of the foot.', normal: 'a neutral arch that matches the foot.', low: 'moderate support to stop the arch dropping further.', flat: 'kept moderate on purpose – a flat foot is supported and controlled with the heel post, not pushed up into a high arch (that hurts).' }[res.archType]} The highest point sits under the navicular bone (inner arch), not further forward.`, ['podLec']);
    add('Heel cup', p.heelCupDepth + ' mm', p.heelCupDepth >= 18 ? 'Deep heel cup: holds the fat pad under the heel and steadies the heel (heel pain / ankle stability).' : p.heelCupDepth >= 14 ? 'Medium-deep cup for more heel control.' : 'Standard 12 mm cup that fits most shoes.', ['rootHC', 'pacRx']);
    if (p.medialPost) add('Medial heel post', p.medialPost + '°', 'Tilts the inner side of the heel up a little so the foot does not roll inward so much. 4° is the usual standard, 6° for strong rolling; more than that is rarely used.', ['nwRx', 'pacRx']);
    if (p.medialHeelSkive) add('Medial heel skive', p.medialHeelSkive + '° equivalent', 'Extra push under the inner heel for an arch that is collapsing (tibialis posterior weakness).', ['nwRx']);
    if (p.lateralWedge) add('Lateral wedge', p.lateralWedge + '°', 'Raises the outer edge so the foot does not roll outward / the ankle does not give way. Kept at 5° or less for comfort.', ['nwRx']);
    if (p.lateralFlange) add('Lateral flange', 'raised outer edge', 'A higher outer wall from heel to midfoot that keeps the foot on the insole when the ankle is unstable.', ['nwRx']);
    if (p.metPad) add('Metatarsal pad', p.metPad === 'neuroma' ? 'neuroma pad between heads 3–4' : 'dome behind heads 2–4', 'A small dome placed just BEHIND the ball of the foot (front edge about 6–11 mm behind the metatarsal heads; with a scan the ball line is measured from the widest forefoot row). It lifts and spreads the bones so the ball of the foot hurts less. Placed too far forward it would increase pressure.', ['hastings', 'podLec']);
    if (p.heelLift) add('Heel lift', p.heelLift + ' mm (in-shoe max 6 mm)', 'Raises the heel (shorter leg, or to unload the Achilles). Inside a shoe 6–8 mm is the practical limit; anything above ~10 mm belongs under the shoe/flip-flop sole.', ['lli', 'ohi', 'nwRx']);
    if (p.mortonExtension) add("Morton's extension", '1.5 mm under big-toe joint', 'A firm extension under the big-toe joint and toe that stops a stiff big toe from bending painfully.', ['podLec']);
    if (p.sesamoidCutout || p.firstMTPRelief) add('Big-toe joint relief', 'soft pocket', 'Removes material under the painful spot so it carries less load.', ['podLec']);
    if (p.heelCutout || p.offloadPockets) add('Offloading pockets', 'soft recesses', 'Small recesses under high-pressure spots (heel centre / ball of foot) so they are not pressed.', ['iwgdf']);
    add('Thickness by zone', p.minThick ? `≥ ${p.minThick} mm everywhere` : 'heel ~' + (2.6 * 1.15).toFixed(1) + ' mm → forefoot ~1.8 mm',
      p.minThick ? 'Diabetic foot: thick, soft, multi-layer cushioning under the whole sole, rounded edges, no hard corrections.' : 'Thicker under heel and arch where support is needed, thin under the toes (sulcus) so the shoe still fits and the toes can bend.', p.minThick ? ['cms', 'iwgdf'] : ['podLec']);
    add('Length', opts.length || 'full length', 'Full length covers the toes (better for toe/ball-of-foot problems); 3/4 (sulcus) length ends just behind the toes and fits tighter shoes.', ['podLec']);
    add('Material', p.shore + (p.dualDensity ? ' dual density' : '') + ' TPU', p.shore === '85A' ? 'Soft, cushioning.' : p.shore === '95A' ? 'Firm, for control of a rolling-in foot.' : 'Medium: support with comfort.', []);
    if (p.referClinician) add('Clinician check', 'recommended', 'Diabetes / neuropathy: feet should be checked by a podiatrist or doctor before and after fitting; any red mark after wearing = stop and re-check.', ['iwgdf']);
    return out;
  }

  /* ---------------- Customer-friendly wording ----------------
     friendly: what the customer sees instead of the medical name.   */
  const FRIENDLY = {
    plantar_fasciitis: 'Morning heel pain', achilles: 'Pain at the back of the heel', metatarsalgia: 'Sore ball of the foot',
    mortons_neuroma: 'Tingling between the toes', bunion: 'Bump at the big toe', hallux_rigidus: 'Stiff big toe',
    sesamoiditis: 'Pain under the big toe', hammer_toes: 'Curled toes', overpronation: 'Feet roll inward',
    supination: 'Feet roll outward', pttd: 'Arch getting flatter', pes_cavus: 'Very high arch', ankle_instability: 'Wobbly ankles',
    leg_length: 'One leg a bit shorter', joint_pain: 'Knee, hip or back pain', diabetic: 'Diabetes care', calluses: 'Hard skin / sore spots',
    arthritis: 'Stiff, achy joints', standing_worker: 'On your feet all day', athlete: 'Sporty & active'
  };
  const ARCH_FRIENDLY = { high: 'High arch', normal: 'Normal arch', low: 'Low arch', flat: 'Flat feet' };
  const ARCH_FRIENDLY_TEXT = {
    high: 'Your arch is nicely high, so we fill the space under it for an even, cushioned feel.',
    normal: 'Your arch is in the healthy middle range. We keep it comfy and supported.',
    low: 'Your arch is a little low. Gentle support helps your feet feel less tired.',
    flat: 'Your arch rests close to the ground. Firm, friendly support helps your whole body line up.'
  };

  /* ---------------- Customer questionnaire (one question per screen) ----------------
     type: 'single' (tap one, auto-advance) or 'multi' (tap several + Next)
     Each option can switch on conditions (cond) and/or set an answer key (set).   */
  const QUESTIONS = [
    { id: 'pain', icon: '📍', title: 'Where does it hurt?', help: 'Tap all that apply', type: 'multi',
      options: [
        { v: 'heel', icon: '🌅', label: 'Heel (morning)', cond: ['plantar_fasciitis'], set: { heelPain: 'yes' } },
        { v: 'backheel', icon: '🦶', label: 'Back of heel', cond: ['achilles'] },
        { v: 'arch', icon: '〰️', label: 'Arch', cond: ['plantar_fasciitis'] },
        { v: 'ball', icon: '🔥', label: 'Ball of foot', cond: ['metatarsalgia'] },
        { v: 'bigtoe', icon: '👣', label: 'Under big toe', cond: ['sesamoiditis'] },
        { v: 'ankle', icon: '🌀', label: 'Ankle', cond: ['ankle_instability'] },
        { v: 'knee', icon: '🦵', label: 'Knee', cond: ['joint_pain'], set: { jointPain: 'yes' } },
        { v: 'back', icon: '🧍', label: 'Hip / back', cond: ['joint_pain'], set: { jointPain: 'yes' } },
        { v: 'none', icon: '😊', label: 'No pain', none: true }] },
    { id: 'toes', icon: '🦶', title: 'Toes', help: 'Anything like this?', type: 'multi',
      options: [
        { v: 'bump', icon: '🔵', label: 'Bump at big toe', cond: ['bunion'] },
        { v: 'stiff', icon: '🪨', label: 'Stiff big toe', cond: ['hallux_rigidus'] },
        { v: 'curled', icon: '🪝', label: 'Curled toes', cond: ['hammer_toes'] },
        { v: 'tingle', icon: '⚡', label: 'Tingling between toes', cond: ['mortons_neuroma'] },
        { v: 'none', icon: '👌', label: 'All fine', none: true }] },
    { id: 'diabetes', icon: '🩺', title: 'Diabetes?', type: 'single',
      options: [{ v: 'no', icon: '🙂', label: 'No', set: { diabetes: 'no' } }, { v: 'yes', icon: '💚', label: 'Yes', cond: ['diabetic'], set: { diabetes: 'yes' } }, { v: 'unsure', icon: '🤔', label: 'Not sure', set: { diabetes: 'unsure' } }] },
    { id: 'shoewear', icon: '👟', title: 'Your old shoes wear out on the…', type: 'single',
      options: [{ v: 'inner', icon: '⬅️', label: 'Inner side', cond: ['overpronation'] }, { v: 'outer', icon: '➡️', label: 'Outer side', cond: ['supination'] }, { v: 'even', icon: '⚖️', label: 'Evenly' }, { v: 'unsure', icon: '🤷', label: 'Not sure' }] },
    { id: 'standing', icon: '⏱️', title: 'Hours on your feet per day', type: 'single',
      options: [{ v: '0-4', icon: '🪑', label: 'Under 4', set: { standing: '0-4' } }, { v: '4-8', icon: '🚶', label: '4 – 8', set: { standing: '4-8' } }, { v: '8+', icon: '🧑‍🏭', label: '8+', cond: ['standing_worker'], set: { standing: '8+' } }] },
    { id: 'activity', icon: '🏃', title: 'How active are you?', type: 'single',
      options: [{ v: 'light', icon: '🌿', label: 'Relaxed', set: { activity: 'light' } }, { v: 'moderate', icon: '🚶‍♀️', label: 'Active', set: { activity: 'moderate' } }, { v: 'athlete', icon: '🏀', label: 'Sporty', cond: ['athlete'], set: { activity: 'athlete' } }] },
    { id: 'weight', icon: '⚖️', title: 'Weight', type: 'single',
      options: [{ v: '<60', icon: '🪶', label: 'Under 60 kg', set: { weight: '<60' } }, { v: '60-90', icon: '🙂', label: '60 – 90 kg', set: { weight: '60-90' } }, { v: '90+', icon: '💪', label: 'Over 90 kg', set: { weight: '90+' } }] },
    { id: 'other', icon: '➕', title: 'Anything else?', help: 'Optional', type: 'multi',
      options: [
        { v: 'skin', icon: '✋', label: 'Hard skin / sore spots', cond: ['calluses'] },
        { v: 'joints', icon: '🌿', label: 'Stiff, swollen joints', cond: ['arthritis'] },
        { v: 'leg', icon: '📏', label: 'One leg shorter', cond: ['leg_length'] },
        { v: 'none', icon: '👍', label: 'Nothing else', none: true }] }
  ];
  function conditionsFromQA(qa) {
    const ids = new Set(), answers = {};
    for (const q of QUESTIONS) {
      const val = qa[q.id]; if (val == null) continue;
      const vals = Array.isArray(val) ? val : [val];
      for (const o of q.options) if (vals.includes(o.v)) { (o.cond || []).forEach(c => ids.add(c)); Object.assign(answers, o.set || {}); }
    }
    return { ids: [...ids], answers };
  }

  /* ---------------- "We'll add" benefits (customer summary) ---------------- */
  function benefits(p) {
    const b = [];
    if (p.noHardEdges) b.push(['🫧', 'Extra-soft, no hard edges']);
    if (p.archHeight >= 15) b.push(['⛰️', 'Extra arch support']); else b.push(['〰️', 'Comfortable arch support']);
    if (p.heelCushion || p.heelCutout) b.push(['☁️', 'Cushioned heel']);
    if (p.heelCupDepth >= 16) b.push(['🥣', 'Deep heel cup that holds your heel']);
    if (p.metPad) b.push(['🟡', 'Soft pad that relieves the ball of your foot']);
    if (p.heelLift) b.push(['⬆️', 'Small heel lift']);
    if (p.medialPost || p.medialHeelSkive) b.push(['🧭', 'Stops your foot rolling inward']);
    if (p.lateralWedge || p.lateralFlange || p.lateralFlare) b.push(['⚓', 'Keeps your ankle steady']);
    if (p.forefootExtraWidth) b.push(['↔️', 'More room for your toes']);
    if (p.firstMTPRelief) b.push(['💜', 'Gentle space for your big-toe joint']);
    if (p.sesamoidCutout) b.push(['🎯', 'Relief under your big toe']);
    if (p.mortonExtension || p.rocker) b.push(['🎢', 'Rolling shape for easier steps']);
    if (p.toeCrest) b.push(['🌉', 'Soft support under your toes']);
    if (p.offloadPockets) b.push(['🕳️', 'Soft pockets that take pressure off sore spots']);
    if (p.shockAbsorb) b.push(['💥', 'Extra shock absorption']);
    if (p.fullContact && !p.noHardEdges) b.push(['🤲', 'Hugs your whole foot']);
    return b;
  }

  /* ---------------- Products ---------------- */
  const PRODUCTS = [
    { id: 'perforated', name: 'Perforated orthotic insole', kind: 'insole', image: 'assets/insole-perforated.jpg',
      desc: 'Thin, ventilated insole with breathing holes. Fits most shoes.', colors: ['#f4f6f6', '#cfd8dc', '#1f2a30', '#0099ff'], examplePrice: 2490 },
    { id: 'flipflop', name: 'Classic thong flip-flop', kind: 'flipflop', image: 'assets/flipflop-classic.jpg',
      desc: 'Everyday flip-flop with your custom footbed built in.', colors: ['#3a3f3a', '#1f2a30', '#6b4f3a', '#0099ff'], strapColors: ['#d8c6a8', '#f4f6f6', '#1f2a30', '#f2994a'], examplePrice: 2990 },
    { id: 'slide', name: 'Lattice slide sandal', kind: 'slide', image: 'assets/slide-lattice.jpg',
      desc: '3D-printed honeycomb mesh slide. Light, airy, washable.', colors: ['#f4f6f6', '#f26b1d', '#1f2a30', '#1aa7d8'], examplePrice: 3490 },
    { id: 'fullcontact', name: 'Full-contact TPU insole', kind: 'insole', image: 'assets/insole-fullcontact.jpg',
      desc: 'Full-length TPU insole with sculpted arch support.', colors: ['#c8784a', '#d9a066', '#1f2a30', '#0099ff'], examplePrice: 2790 },
    /* v7 insole line – every model is built on the smooth-toe (v6.1) scan surface. `model` = real geometry differences (used by fit.js /
       geometry.js for preview + STL); `params` = forced clinical settings; `print` = TPU print settings (spec JSON + staff mode). */
    { id: 'sport', name: 'Fixifoot Sport', kind: 'insole', line: 'v7', image: 'catalog/sport.png', tagline: 'Bounce back with every step',
      desc: 'Springy 7 mm insole for running, gym and court sports. Energy-return core, soft top, extra shock absorption under the heel.',
      colors: ['#0099ff', '#015ad8', '#1f2a30', '#ffd22e'], examplePrice: 3290,
      model: { heelT: 8, foreT: 6, length: 'full', archBoost: 1.5, openings: null, recesses: [], rim: 0.6, summary: '8 mm heel → 6 mm forefoot, deep 18 mm heel cup, medium arch (+1.5 mm)' },
      params: { heelCupDepth: 18, shockAbsorb: true, dualDensity: true, heelCushion: true, shore: '95A', infill: 'gyroid 20% (heel 35%)', topCover: 1.2 },
      print: { base: 'TPU 95A', top: 'TPU 85A soft top layer, 1.2 mm (dual-material or pause-and-swap)', pattern: 'gyroid', infill: '20%', walls: 3, topLayers: 5, bottomLayers: 4, layer: '0.2 mm',
        zones: [{ zone: 'Heel shock zone (rear 30%)', infill: 'gyroid 35%', why: 'denser = more shock absorption at heel strike' }, { zone: 'Forefoot', infill: 'gyroid 20%', why: 'energy return at toe-off' }],
        nozzleC: '225-235', bedC: '50', speed: '30-40 mm/s', notes: 'Gyroid core gives springy energy return. Print heel-down, no supports.' } },
    { id: 'everyday', name: 'Fixifoot Everyday', kind: 'insole', line: 'v7', image: 'catalog/everyday.png', tagline: 'All-day comfort in your regular shoes',
      desc: 'Slim 3–4 mm full-contact insole that fits regular shoes. Gentle heel cup and breathing holes.',
      colors: ['#f4f6f6', '#0099ff', '#cfd8dc', '#1f2a30'], examplePrice: 2490,
      model: { heelT: 4, foreT: 3, length: 'full', archBoost: 0, openings: 'holes', recesses: [], rim: 0.5, summary: '4 mm heel → 3 mm forefoot, gentle 10 mm heel cup, full-contact arch, ventilation holes' },
      params: { heelCupDepth: 10, fullContact: true, shore: '90A', infill: 'gyroid 25%', topCover: 0.8 },
      print: { base: 'TPU 90A', top: 'none (optional 0.8 mm fabric top cover)', pattern: 'gyroid', infill: '25%', walls: 3, topLayers: 4, bottomLayers: 3, layer: '0.16 mm',
        zones: [{ zone: 'Around holes', infill: 'solid walls (3 perimeters)', why: 'clean, strong hole edges' }],
        nozzleC: '220-230', bedC: '50', speed: '30 mm/s', notes: 'Thin part: print slow, 0.16 mm layers for a smooth top.' } },
    { id: 'diabetic', name: 'Fixifoot Diabetic Care', kind: 'insole', line: 'v7', image: 'catalog/diabetic.png', tagline: 'Extra-soft protection for sensitive feet',
      desc: 'Very soft 6–7 mm total-contact insole. Spreads pressure evenly, rounded edges, extra-soft zones under the ball of the foot and big toe.',
      colors: ['#e8f4ff', '#cfd8dc', '#0099ff', '#1f2a30'], examplePrice: 3490,
      model: { heelT: 7, foreT: 6.2, length: 'full', archBoost: 0, openings: null, rim: 1.4,
        recesses: [{ id: 'metHeads', label: 'Extra-soft pocket – metatarsal heads', at: 'met', depth: 1.5 }, { id: 'hallux', label: 'Extra-soft pocket – hallux', at: 'hallux', depth: 1.5 }],
        summary: '7 mm heel → 6.2 mm forefoot, total contact, rounded 1.4 mm edges, 1.5 mm soft-insert pockets under met heads + hallux' },
      params: { noHardEdges: true, fullContact: true, minThick: 6, shore: '80-85A', infill: 'gyroid 15%', topCover: 3, heelCupDepth: 14 },
      print: { base: 'varioShore TPU (foamed, ~80A at 240 °C) or TPU 80-85A', top: '3 mm soft top cover (PORON / plastazote) – recommended', pattern: 'gyroid', infill: '15%', walls: 2, topLayers: 4, bottomLayers: 3, layer: '0.2 mm',
        zones: [{ zone: 'Met-head + hallux pockets', infill: 'gyroid 8% or fill with 1.5 mm PORON insert', why: 'extra-soft offloading of high-pressure spots' }],
        nozzleC: 'varioShore 230-250 (hotter = softer) / TPU 85A 220-230', bedC: '40-50', speed: '20-25 mm/s', notes: 'Diabetes: check the feet daily; podiatrist review before and after fitting.' } },
    { id: 'work', name: 'Fixifoot Work & Stand', kind: 'insole', line: 'v7', image: 'catalog/work.png', tagline: 'Made for long shifts on your feet',
      desc: '5 mm insole with maximum cushioning under heel and ball, plus strong arch support for long hours standing.',
      colors: ['#1f2a30', '#015ad8', '#ffd22e', '#cfd8dc'], examplePrice: 2990,
      model: { heelT: 5.5, foreT: 5, length: 'full', archBoost: 3, openings: null, recesses: [], rim: 0.7, summary: '5.5 mm heel → 5 mm forefoot, strong arch (+3 mm), 16 mm heel cup' },
      params: { heelCupDepth: 16, heelCushion: true, shockAbsorb: true, dualDensity: true, shore: '92A', infill: 'gyroid 20% (heel + ball 12%)', topCover: 1.5 },
      print: { base: 'TPU 92A', top: 'TPU 85A, 1 mm', pattern: 'gyroid', infill: '20%', walls: 3, topLayers: 5, bottomLayers: 4, layer: '0.2 mm',
        zones: [{ zone: 'Heel + ball cushion zones', infill: 'gyroid 12%', why: 'softer = max cushioning where pressure peaks' }, { zone: 'Arch', infill: 'gyroid 35%', why: 'firm arch support' }],
        nozzleC: '225-235', bedC: '50', speed: '30 mm/s', notes: 'Strong arch: keep 3 walls in the midfoot.' } },
    { id: 'dress', name: 'Fixifoot Dress Slim', kind: 'insole', line: 'v7', image: 'catalog/dress.png', tagline: 'Invisible support for dress shoes & heels',
      desc: 'Ultra-slim 2–3 mm, 3/4-length insole with a ball-of-foot pad. Fits dress shoes, flats and heels.',
      colors: ['#d9a066', '#1f2a30', '#f4f6f6', '#c8784a'], examplePrice: 2690,
      model: { heelT: 3, foreT: 2.2, length: '3/4', frontMm: 6, archBoost: 0, openings: null, recesses: [], rim: 0.4, summary: '3/4 length (ends ~6 mm past the met-head line), 3 mm heel → 2.2 mm front with skived edge, met pad, 10 mm heel cup' },
      params: { metPad: 'central', heelCupDepth: 10, shore: '95A', infill: '100% (solid)', topCover: 0.5 },
      print: { base: 'TPU 95A', top: 'thin leather / microfibre top cover', pattern: 'concentric (solid)', infill: '100%', walls: 2, topLayers: 3, bottomLayers: 3, layer: '0.12 mm',
        zones: [{ zone: 'Met pad', infill: 'solid', why: 'keeps the pad shape inside narrow shoes' }],
        nozzleC: '220-230', bedC: '50', speed: '25 mm/s', notes: 'Very thin: print solid, 0.12 mm layers, brim recommended.' } },
    { id: 'kids', name: 'Fixifoot Kids', kind: 'insole', line: 'v7', image: 'catalog/kids.png', tagline: 'Gentle support for growing feet',
      desc: 'Flexible, soft insole with a gentle arch and a stable heel cup. Scales with smaller sizes.',
      colors: ['#ffd22e', '#0099ff', '#5cc2ff', '#f26b1d'], examplePrice: 1990,
      model: { heelT: 3.2, foreT: 2.2, length: 'full', archBoost: 0, archFill: 75, openings: null, recesses: [], rim: 0.9, scaleWithSize: true, summary: '3.2 mm heel → 2.2 mm flexible forefoot, gentle arch (75% fill), stable 14 mm heel cup; thickness + cup scale with foot length (ref 240 mm)' },
      params: { heelCupDepth: 14, noHardEdges: true, shore: '85A', infill: 'gyroid 15%', topCover: 1 },
      print: { base: 'TPU 85A (flexible)', top: 'none / soft fabric', pattern: 'gyroid', infill: '15%', walls: 2, topLayers: 4, bottomLayers: 3, layer: '0.16 mm',
        zones: [{ zone: 'Heel cup wall', infill: '3 walls', why: 'stable heel cup' }, { zone: 'Forefoot', infill: 'gyroid 10%', why: 'flexes with the foot' }],
        nozzleC: '220-230', bedC: '45', speed: '20-25 mm/s', notes: 'Re-scan every 6-9 months (growing feet).' } }
  ];
  // v7: which model fits this customer best (shown as "Recommended for you" in the model picker)
  function recommendProduct(conditions = [], answers = {}, footLengthMm = null) {
    const c = new Set(conditions);
    if (c.has('diabetic') || answers.diabetes === 'yes') return { id: 'diabetic', why: 'Diabetes care: extra-soft total contact, no hard edges' };
    if (footLengthMm && footLengthMm < 215) return { id: 'kids', why: 'Small foot (kids size): flexible, gentle support' };
    if (c.has('athlete') || answers.activity === 'athlete') return { id: 'sport', why: 'Sporty: energy return + heel shock absorption' };
    if (c.has('standing_worker') || answers.standing === '8+') return { id: 'work', why: 'On your feet all day: max cushioning + strong arch' };
    if (c.has('metatarsalgia') || c.has('mortons_neuroma')) return { id: 'everyday', why: 'Ball-of-foot comfort in your regular shoes' };
    return { id: 'everyday', why: 'Slim, all-day comfort for regular shoes' };
  }
  const ADDON_EXAMPLE_PRICE = 150; // per advanced modification (example only)

  global.FixiRules = { rationale, REFS, FRIENDLY, ARCH_FRIENDLY, ARCH_FRIENDLY_TEXT, QUESTIONS, conditionsFromQA, benefits, ARCH_TYPES, ZONES, CONDITIONS, PRODUCTS, recommendProduct, ADDON_EXAMPLE_PRICE, SHORE_ORDER, combine, autoConditionsFromAnswers, suggestFromScan };
})(window);
