# Fixifoot orthotist engine – prescription rules (v12)

> **Clinical review required.** These rules turn a 3D foot scan, or entered measurements, into a *starting* prescription. They come from published rules of thumb and common orthotic-lab practice. They are **not** a diagnosis, and the device is a comfort product, not a medical device. A **licensed orthotist / podiatrist must review and approve these rules, and each fitting report**, before anyone relies on them. Review matters most for diabetes, children, rigid deformities, neuropathy or ongoing pain. Staff can override every value in the Fitting report before export.

Code: `orthotic.js` (`measureFoot` → `prescribe` → `applyCorrections`). Glue code is in `app.js` (`fittingFor`, `currentSpec`, `renderFitReport`). The PDF is built in `receipt.js` (`buildFittingPdf`). The engine runs for every product (insoles and flip-flop/slide footbeds), separately for the left and right foot. Its output becomes the geometry parameters that the STL, the 2-material 3MF and the preview are built from.

## 1. Measurements (from the 2 mm plantar height map + the aligned mesh)

| Measurement | How | Notes |
|---|---|---|
| Foot length, ball width, heel width | Map outline (heel → longest toe, widest forefoot row, heel row) | Same values as the fit check |
| Arch height (plantar apex) | Highest point of the medial-arch soft tissue above the floor, 2 mm map | Proxy for navicular height; a scan of the sole cannot see the bone |
| Arch height index (AHI %) | Arch height ÷ foot length × 100 | Fixifoot scan thresholds: **< 6.5 % flat · 6.5–7.8 % low · 7.8–10.5 % normal · > 10.5 % high**. If the Chippaux-Smirak index (CSI) is > 60 %, the type moves one step flatter. Typical arch height = 8.5 % of length. *Calibrated on the sample scans – validate on real patients.* |
| Chippaux-Smirak index (CSI) | Narrowest midfoot contact ÷ widest forefoot contact | Chippaux 1985; Forriol & Pascual 1990. Shown alongside AHI. Footprint indices are known to misclassify some feet, so arch height is preferred. |
| Rearfoot alignment (°) | Posterior heel (back 8 % of length): centre of the heel at 3–12 mm height vs 25–40 mm height. + = valgus/everted, − = varus | Approximates the bisection of the calcaneus seen from behind (resting calcaneal stance position, RCSP). Normal resting stance: about 0–4° everted (Root et al. 1977; Sobel et al. 1999). If the scan has less than about 32 mm of heel height, the angle is **estimated from the arch type** (flat 6°, low 4°, normal 2°, high −2°) and marked "estimated". |
| Met-head line, toe length | Ball line (widest forefoot row) from the heel; ball → toe tip | |
| Pressure zones | Share of "contact" cells (sole within 2.5 mm of the floor) under heel / midfoot / met heads / hallux | A static contact proxy, not a pressure plate. Typical scans show about 45–49 % under the met heads. |
| L/R difference | Foot length difference when both feet are scanned | A foot-length difference is *not* a leg-length difference; each insole is sized to its own foot. |

Feet entered without a scan (measurements or self-measure) are flagged **APPROX**. For these feet the shape comes from a typical foot of that length, width and arch type, and every limit below is the conservative one.

## 2. Corrections

| Correction | Rule | Limits | Source / rationale |
|---|---|---|---|
| **Arch support (extra height)** | Flat or low arch: ½ × (typical − measured arch height); at least 2 mm for flat feet and 1 mm for low arches. High or normal arch: 0 (total contact only). | Max **5 mm** adult; **2 mm** for diabetes, children or APPROX feet. The product model's own arch boost is subtracted. | Partial correction of a *flexible* flat foot is standard. Full correction is poorly tolerated (Kirby 2000; Landorf & Keenan 2000). Assumes a flexible flat foot: a rigid flat foot needs ≤ 1.5 mm, which staff must check by hand. |
| **Arch contact fill** | 100 % (total contact). Diabetes: 95 %. | 60–100 % | Total-contact inserts spread plantar load (IWGDF 2023) |
| **Heel cup depth** | 5 % of foot length; **6.5 %** if the foot is flat or the heel valgus is > 4° | 8–18 mm insole; **max 10 mm** flip-flop; **max 12 mm** child | Deeper cups contain the heel fat pad and help control rearfoot eversion (Kirby 2000; common orthotic-lab practice of 12–18 mm for control devices) |
| **Medial rearfoot post** | Heel valgus > 4°: (valgus − 2°). Flat foot without valgus: 2°. A staff or questionnaire problem of over-pronation / PTTD raises it to ≥ 3°. | **2–6°** adult (Kirby rearfoot posting range). Max 3° for a child, an APPROX foot or an estimated angle; 4° for flip-flops; **2° for diabetes**. | Rearfoot varus posting of 2–6° is typical (Kirby 2000, "Foot and lower extremity biomechanics"; Root functional orthoses) |
| **Lateral wedge** | Heel varus < −2°, or a high arch with negative alignment: (−angle + 1°). A staff or questionnaire problem of supination / ankle instability / cavus gives 3°. Cannot be combined with a medial post. | 2–5° (max 2° for diabetes) | Lateral posting for cavus / supinated feet and ankle instability (Burns et al. 2006, cavus foot orthoses) |
| **Metatarsal pad** | Met-head contact share > 55 % (> 50 % for a high arch), or metatarsalgia, Morton's neuroma, calluses or sesamoiditis. The dome apex sits about 15 mm **proximal** to the met-head line. | Not for diabetes (soft relief instead) or for children without symptoms | A pad proximal to the met heads lowers peak met-head pressure (Hsi et al. 2005; Hayda et al. 1994; Kang et al. 2006) |
| **Forefoot / hallux relief** | Diabetes: soft relief pockets (heel, met heads, hallux). Otherwise: 1 mm 1st-MTP relief for hallux contact > 12 %, hallux rigidus or bunion. | – | IWGDF 2023 footwear and offloading guideline; first-ray cut-outs for hallux limitus (Welsh et al. 2010) |
| **Heel lift (leg-length difference)** | From the questionnaire and staff entry, shorter side only. < 4 mm: none. Otherwise the full difference up to the cap. | Max **6 mm** inside a shoe insole; 8 mm for a flip-flop footbed. Any remainder goes into the shoe or sole. | Gurney 2002 (LLD review); common practice is to correct about 50–100 % and to keep in-shoe lifts ≤ 6 mm |
| **Soft top / no hard edges** | Diabetes | – | IWGDF 2023: accommodative, cushioned, no high-pressure edges |

### Special groups
- **Diabetes** (questionnaire "diabetes: yes" or the Diabetic problem): accommodative, not corrective. Arch lift ≤ 2 mm, posting ≤ 2°, 95 % arch fill, no firm met pad, soft relief pockets, soft top, no hard edges. Refer to a podiatrist; check feet daily. (Bus et al., IWGDF guidelines 2023.)
- **Children** (Kids model or foot < 215 mm): flexible flat feet are normal in many children and often need no orthosis (Evans 2008; Evans & Rome 2011). Limits are arch ≤ 2 mm extra, posting ≤ 3°, cup ≤ 12 mm, and no met pad.
- **No scan (APPROX)**: arch ≤ 2 mm, posting ≤ 3°, and the angle is estimated. A rescan is recommended.
- **Flip-flops / slides**: there is no shoe counter, so heel cups are shallow (≤ 10 mm) and posting is gentle (≤ 4°).

### What the engine cannot judge
- Rigid vs flexible flat foot (needs a heel-raise / Jack's test), forefoot varus/valgus, ankle dorsiflexion, gait, pain. Staff must check these and override.
- The rearfoot angle is a geometric heuristic from a static, non-weight-bearing or partial-weight-bearing scan. It is not a goniometer measurement.
- The thresholds were tuned on the Fixifoot sample scans, not on a clinical dataset.

## References
- Chippaux JF. Contribution à l'étude de l'empreinte plantaire. 1985. Forriol F, Pascual J. Footprint analysis between three and seventeen years of age. *Foot Ankle* 1990;11:101-4.
- Williams DS, McClay IS. Measurements used to characterize the foot and the medial longitudinal arch: reliability and validity. *Phys Ther* 2000;80:864-71.
- Root ML, Orien WP, Weed JH. *Normal and Abnormal Function of the Foot.* 1977.
- Sobel E, Levitz S, et al. Natural history of the rearfoot angle: preliminary values in 150 children. *Foot Ankle Int* 1999;20:119-25.
- Kirby KA. *Foot and Lower Extremity Biomechanics.* Precision Intricast, 1997/2000/2002.
- Landorf KB, Keenan AM. Efficacy of foot orthoses. What does the literature tell us? *J Am Podiatr Med Assoc* 2000;90:149-58.
- Hsi WL, Kang JH, Lee XX. Optimum position of metatarsal pad in metatarsalgia for pressure relief. *Am J Phys Med Rehabil* 2005;84:514-20.
- Hayda R, Tremaine MD, Tremaine K, Banco S, Teed K. Effect of metatarsal pads and their positioning: a quantitative assessment. *Foot Ankle Int* 1994;15:561-6.
- Kang JH, Chen MD, Chen SC, Hsi WL. Correlations between subjective treatment responses and plantar pressure parameters of metatarsal pad treatment in metatarsalgia patients. *BMC Musculoskelet Disord* 2006;7:95.
- Burns J, Crosbie J, Ouvrier R, Hunt A. Effective orthotic therapy for the painful cavus foot. *J Am Podiatr Med Assoc* 2006;96:205-11.
- Bus SA, et al. IWGDF guidelines on offloading foot ulcers / footwear in persons with diabetes, 2023 update. *Diabetes Metab Res Rev* 2024.
- Evans AM. The flat-footed child – to treat or not to treat. *J Am Podiatr Med Assoc* 2008;98:386-93. Evans AM, Rome K. A Cochrane review of the evidence for non-surgical interventions for flexible pediatric flat feet. *Eur J Phys Rehabil Med* 2011;47:69-89.
- Gurney B. Leg length discrepancy. *Gait Posture* 2002;15:195-206.
- Welsh BJ, et al. A case-series study to explore the efficacy of foot orthoses in treating first metatarsophalangeal joint pain. *J Foot Ankle Res* 2010;3:17.

*Reviewed by (orthotist / podiatrist): ____________________  Date: ________*
