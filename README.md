# Fixifoot Philippines – custom insole & flip-flop DEMO

Static web app (no build step). Serve the folder and open on a phone:

    python3 -m http.server 8000      # then open http://<your-computer-ip>:8000
    # Camera needs HTTPS or localhost. For phones on Wi-Fi use e.g. `npx localtunnel` / ngrok, or upload a scan file.

## Files
- index.html, styles.css – UI (mobile-first)
- app.js       – flow, customer/staff mode, viewers, export
- rules.js     – EDIT ME: arch types, 21 foot problems -> insole changes, questionnaire, friendly wording, products, example prices
- geometry.js  – procedural foot, insole/sole/flip-flop/slide geometry, printable STL builder, template adaptation
- receipt.js   – v10 PDF receipt (jsPDF, vendored in vendor/jspdf.umd.min.js; DejaVu Sans subset in vendor/fonts/receipt-fonts.js)
- engrave.js   – v9 initials engraving as real geometry (manifold-3d booleans, lazy-loaded)
- vendor/      – three.js r160 (vendored, works offline); manifold/ (manifold-3d 3.5.4, Apache-2.0); fonts/fx-font.js (Helvetiker Bold subset)
- assets/      – product photos, templates/ (Jacky's L90 + S90 insoles, repaired watertight STL)

## Modes
- Customer mode (default): simple words, one question per screen, "Your feet -> We'll add" summary.
- Staff mode: tap "🔒 Staff", PIN 1234 (change STAFF_PIN in app.js). Shows checklist, overrides, support settings, conflicts, template choice and "Send to production" (JSON spec + STL per foot).

## Shortcuts for demos
    ?demo=flat&cond=plantar_fasciitis,metatarsalgia&product=fullcontact&screen=s-result&staff=1

## What is simulated
Camera capture is a demo animation; measurements for a demo scan are generated. Real 3D phone scanning needs a native app
(iPhone TrueDepth/LiDAR via ARKit, or an Android photogrammetry SDK). Uploading a real STL/OBJ scan works.
Not a medical device – comfort product; refer diabetes/pain to a podiatrist.

## v3 (Oct 2026)

### Realistic 3D foot, full 360°
- Foot mesh: **"Blender Foot realistic" by Dan Ulrich / Blender Studio** (Human Base Meshes bundle v1.2.0), **CC0 1.0 public domain** –
  https://commons.wikimedia.org/wiki/File:Blender_Foot_realistic_by_Dan_Ulrich_(CC0).stl .
  Decimated 3.0M → 34k triangles, cut at 118 mm (ankle) and capped, mirrored for the right foot, stored in `assets/foot-scan.js` (int16).
  At runtime it is scaled to the scanned length/width, mirrored for L, and the medial arch is deformed per arch type (high +7 mm, low −3.5, flat −6.5 at ~41 % of length).
- Viewer: TrackballControls (no polar limits – rotate over the top and under the sole), pinch/scroll zoom, auto-spin on load,
  preset views Top / Bottom / Inside / Outside / Back / Front, Right / Left / Both, toggles: 🔥 plantar pressure, 🕸 mesh wireframe, ✨ scan look (point cloud shimmer).

### Branding
- Logo: official Fixifoot logo from https://fixifoot.ph/wp-content/uploads/2023/10/fxf_horizontal_logo-21_2.webp → `assets/logo.png` (swap this one file to change it).
- Palette (Elementor global colours on fixifoot.ph): primary `#0099FF`, deep blue `#015AD8`, dark `#162327`, accent yellow `#FFD22E`, light grey `#ECECEC`, black text `#000000` (+ secondary blues `#0A6EBD`, `#5A96E3`, `#A1C2F1`).

### On-device CRM (staff → 📇 Customers)
localStorage key `fxCRM_v1`: name, phone, L/R scan data (incl. 48×24 plantar height grid for uploaded scans), detected problems, settings, order history.
Search by name/phone/order no. **New order from saved scan** regenerates spec + both STLs without rescanning. Two demo customers are seeded on first run.

### Clinical review (staff → 🩺 Clinical rationale)
Arch apex ~41 % of foot length (navicular); arch by type high 20 / normal 15 / low 12 (cap 16) / flat 10 (cap 14) mm;
heel cup 12 standard – 14/16 control – 18-20 deep (KevinRoot, Pacific Orthotic Rx); medial post 4° std, max 6°; lateral wedge ≤5°;
met pad apex 6–11 mm proximal to met heads 2-4 (~66 % length; Hastings 2007); heel lift ≤6 mm in-shoe, >10 mm external (Cochrane 2021, OHI);
zone thickness heel ~3 mm → forefoot ~1.8 mm (sulcus); diabetic: total contact, ≥6.4 mm (1/4") cushioning, no posting, rounded edges (IWGDF 2023, CMS LCD L33369).
**Total contact**: when a real scan (STL/OBJ) is uploaded the insole top follows the scanned plantar surface (rearfoot + midfoot, 85 % of height); toggle in the dashboard.

## v4 (Oct 2026) – scan-accurate fitting (`fit.js`)

### 1. Auto-alignment of uploaded STL/OBJ (staff → 🧭 Scan alignment)
- Units: the scale (m / cm / mm) that makes the scan 150–1000 mm long. Staff can override.
- Clean-up: vertices welded, only the largest connected piece kept (floating debris removed).
- Up direction: sphere search (500 directions + hill-climb) for the direction whose lowest slab has the biggest touching area (the sole).
- Floor (plantar plane): RANSAC + refinement for a supporting plane under the lowest points (≤1 % of points may be below it), then tilt-corrected so the floor is at y = 0.
- Long axis: PCA of the footprint (<25 mm). Heel vs toe: the ankle/leg mass sits over the heel; without an ankle, the forefoot is the wider end.
- Left / right: the medial arch side is higher. If the arch is flat, the longest toe marks the inside.
- Ankle/leg above 40 mm is ignored for the plantar map, and the 3D view clips it.
- Staff view: aligned scan on the floor grid, trim plane, heel→toe arrow, auto-detected values, 2 mm plantar height map.
  Nudges: swap heel/toe, upside down, mirror L↔R, turn 90°, pitch/roll ±1°, yaw ±2°, units, reset.
  The scan is assigned to the detected foot, then the other foot is scanned or uploaded.

### 2. Full-length total contact
- The plantar surface is rasterised as a lower envelope on a **2 mm grid**. It uses only sole triangles flatter than ~65°, so side walls do not lift the rim. One light smoothing pass, and the surface is extended past the outline.
- Insole top = plantar surface × arch fill + one constant. Then:
  - heel cup walls rise from the **scanned heel contour**;
  - clinical modifications are added on top (met pad 6–11 mm behind the measured ball line, posts, wedge, heel lift, toe crest at the measured sulcus, Morton's extension, offload pockets).
- Thickness changes only linearly from heel to toe, so the foot can follow it as a rigid pitch. Bottom is flat on Z = 0.
- Arch fill by condition: default 100 %, arthritis 90 %, plantar fasciitis + high arch 95 %, diabetic always 100 %. Staff slider 70–100 %.
- The plantar height is capped 2 mm above the measured arch apex, so the rim never climbs the side of the foot.
- Outline = scanned footprint silhouette (<20 mm) + product allowance:
  - insole: side 1.5 / heel 1 / toe 6 mm, or trimmed to the shoe last length when an EU size is chosen;
  - flip-flop / slide: side 6 / heel 5 / toe 8 mm.

### 3. Template morphing (L90 / S90)
- XY warp, non-uniform and piecewise-linear along the length: knots at heel / template arch apex → scanned arch apex / template ball → scanned ball line / toe (S90 = 72 % coverage). Width maps onto the scanned outline row by row.
- Z: the top surface follows the plantar map + cup + mods. A single constant keeps ≥ the minimum thickness over the template's own curved bottom (98 % of the bed). The template rim shape is kept.

### 4. Flip-flop / slide
- Contoured footbed from the plantar map, flat outsole on Z = 0, 5 mm heel-to-toe drop (linear).
- Toe-post position = detected 1st/2nd toe gap (4 mm proximal). Strap ends = ball-line landmarks (ballU − 10 %).
- The coordinates are written to the spec (`strapHolesMm`, in the STL frame). Holes are **not** cut into the STL.

### 5. Fit check (staff → 📊 Fit check, badge on the dashboard)
- The product's top surface is rasterised on the same 2 mm grid.
- Foot placement = robust least-squares offset + tilt (the foot standing on the insole).
- gap = scanned sole − insole top. Positive = air gap, negative = pressure.
- Stats over the contact area (plantar height ≤25 mm, edge eroded 4 mm): mean |gap|, signed mean, max gap / pressure, p95, % within ±1 / ±2 mm.
- Intentional modifications are hatched and reported separately.
- **PASS** = mean |gap| < 1 mm and ≥ 80 % within ±1 mm. WARN < 1.6 mm. Otherwise FAIL.
- Views: 3D heat map with ghost foot, plus a 2D deviation map with ball line and toe-gap markers.

### 6. Test scans (`samples/v4-test-scans/`, generator `generate_test_scans.py`)
All test scans are deformations of the CC0 Blender foot (no real customer scan was available).
- flat 255 mm rotated
- high arch 275 mm in cm, rotated
- left foot in metres, Z-up, rotated
- original with leg (left, m, Z-up)
- noise 0.35 mm + debris
- 8° tilt
- low arch OBJ in cm

Results: `fit-results.json` / `fit-results-summary.txt`. All 8 got side, units, heel/toe and length right (±2 mm).
Plantar-map error vs ground truth: 0.02–0.34 mm mean (0.62 mm with noise).
Fit mean |gap|:
- 0.09–0.14 mm (noise scan 0.30–0.41 mm) for contact insole, L90, S90, flip-flop and slide;
- 98–100 % within ±1 mm (noise 93–96 %); p95 ≤ 0.6 mm (noise ≤ 1.5 mm).
All 32 exported STLs are watertight, winding-consistent and have Z = 0 at the bottom.
Limits: see the v4 report (the fit check measures against the same scan the product was built from; real feet deform under load).

## v5 (Oct 2026) – cloud CRM on Supabase (`cloud.js`, `config.js`, `supabase/`)

The CRM can live in Supabase (Postgres + Auth + Storage) instead of the browser. **The cloud switch is `config.js`:**

```js
window.FIXI_CLOUD = { url: 'https://<project-ref>.supabase.co', anonKey: '<anon / publishable key>' };
```

* Empty `config.js` (as published right now): fully offline demo, so the on-device CRM and staff PIN 1234 work exactly like v4.
* Filled `config.js`: the staff button opens **email + password sign in / create staff account / forgot password**. In cloud mode there is no PIN. If the network or the cloud is down, the app falls back to the PIN and the on-device CRM.
* Only the public anon key goes in the frontend; never put the service_role key in it. All access is enforced by row-level security (RLS).

**Database** (`supabase/migrations/20261004120000_fixifoot_crm.sql`)

| Object | What it holds and who can access it |
|---|---|
| `staff_profiles` | user_id, email, name, role pending / staff / admin. Created automatically on sign-up as **pending**. |
| `customers` | id, name, phone, email, notes, profile jsonb (questionnaire, overrides, settings), created_at/updated_at, created_by. |
| `scans` | customer_id, side L/R, source, `mesh_path` (raw scan STL in the `scans` bucket), `plantar_map` jsonb (2 mm height map), `metrics` jsonb, created_at/by. |
| `orders` | order_no, customer_id, product, color, size, problems/settings/spec jsonb, `stl_paths` (in the `stl` bucket), status, created_at/by. |
| Storage buckets `scans` and `stl` | Private, 50 MB per file. |

**Access rules (RLS)**

* anon has no grants at all.
* Pending users see nothing.
* staff can read, insert and update.
* Only admins can delete or change roles.
* Nobody can promote themselves.

**What the app does in cloud mode**

* 💾 Save customer upserts the customer and adds a scan row per changed foot, uploading the raw STL/OBJ scan as STL.
* Send to production and Re-order upload the generated STLs and spec and create an order.
* 📇 Customers loads from the cloud: search, detail, order history and re-order from the saved scan.
* **Customer-facing flow needs no login.** Orders placed without a staff session stay on the device. After signing in, staff see a **⬆️ Upload on-device customers** button.
* Admins get **👥 Staff accounts** to approve sign-ups (pending → staff / admin).

**Setting it up**

1. Apply the migration to the Supabase project.
2. Fill in `config.js`.
3. Add the site URL to Auth → URL configuration, so confirmation and reset emails come back to the app.
4. Jacky signs up in the app (Staff view → Create staff account) and confirms his email.
5. Run `supabase/promote_admin.sql` with his email.
6. Once all staff accounts exist, switch off **Auth → Sign In / Providers → Allow new users to sign up**. New staff are then invited from the dashboard (Auth → Users → Invite), or sign-ups are switched on briefly. Pending accounts have no data access in any case.

### v5 live status (4 Oct 2026)

**Project and keys**

* Supabase project **fixifoot**: ref `kbeplmkinzynpelatzqs`, region ap-southeast-1, free plan, URL https://kbeplmkinzynpelatzqs.supabase.co.
* `config.js` holds the **publishable** key only.

**Migrations applied**

* `fixifoot_crm`
* `private_role_helpers`: moves the SECURITY DEFINER role checks to a non-exposed `private` schema.

**Advisors and tests**

* Security and performance advisors: 0 findings.
* End-to-end test on the live site passed and its data was removed: pending / staff / admin permissions, save, upload, order, search, re-order, delete and sign-out.

**Email**

* With Supabase's built-in email sender, only email addresses of **members of the Supabase organization** are accepted. Others are rejected with `Email address "…" is invalid`.
* For other staff, either set up custom SMTP (Auth → Emails → SMTP settings) or create their user in Auth → Users → Add user, ticking "Auto confirm user".

## v6 (Oct 2026) – real holes and lattice in the STL (`openings.js`)

Ventilation holes (perforated insole) and lattice openings (lattice slide) used to be visual only (alpha textures). They are now **real geometry**: the 3D preview and the exported STL are the **same mesh**.

* **How it works (2D profile, no CSG):**
  * The sole is re-meshed on a tile grid in its own (length × across) parameter space.
  * Each tile that gets an opening is re-triangulated: a zipper between the tile border and the opening polygon, plus a vertical wall from top to bottom.
  * Every edge is shared by exactly two faces, so the mesh stays watertight and manifold.
  * It works on both the scan-based total-contact sole and the parametric sole.
* **Perforated insole:**
  * Through-holes of Ø 3 / 3.5 / 4 mm (12-sided).
  * Spacing Low 9 / Medium 7.5 / High 6.2 mm, staggered rows.
  * Kept solid: heel cup (first 25 % of length), medial arch support (25–62 %), toe end, a 5 mm edge margin and the metatarsal-pad dome when prescribed.
* **Lattice slide:**
  * Through hexagon cells: Low 12 mm / 2.4 mm walls, Medium 9.5 / 2.0, High 7.5 / 1.6.
  * Kept solid: a 7 mm perimeter rim and both strap-anchor bands.
* **Wall thickness:** at least 1.2 mm guaranteed (3 perimeters with a 0.4 mm nozzle). The target is 1.6 mm for holes and the preset wall for lattice. Each opening is checked against its tile border (≥ wall/2) and the outline (≥ rim), and is shrunk or skipped if it doesn't fit.
* **Staff controls:** Product & model → *Real ventilation holes / Real lattice openings* on/off, density/spacing, hole diameter. Live stats show the count, open area, min wall, rim and triangles. The setting is saved with the customer and written to the spec JSON (`product.openings`, `stlFiles[].openings`).
* **Template base (L90 / S90):** holes are **not** cut into template models. Use the parametric or scan sole for real openings.
* **Samples:** `samples/v6-perforated-insole-holes-{right,left}.stl`, `samples/v6-lattice-slide-sole-{right,left}.stl`.
* **Screenshots:** `screenshots/v6-*.png`
  * `v6-stl-*`: the exported STL rendered directly.
  * `v6-staff-*` and `v6-preview-*`: the in-app viewer.

## v6.1 (Oct 2026) – smooth forefoot, no ridges between the toes (`fit.js`)
- Scan-based surface (`deriveModel` → `md.sampleF`): from ~14 mm behind the metatarsal-head line forward the scanned relief is replaced by a
  robust, lower-envelope-weighted **quadratic surface** (1, t, t², s, s², s·t in a fixed ball-row frame) – a template-like forefoot with gentle toe
  spring. It is blended into the scanned arch/heel with a smoothstep over ~18 mm (ballU − 14 mm → ballU + 4 mm): no step, no kink.
- Used by every scan-based model (full-contact, perforated, slide, flip-flop, morphed templates). Prescribed modifications (met pad, toe crest,
  Morton's extension, reliefs) are still added on top. The parametric path was already analytic/smooth in the forefoot (verified).
- The fit check ignores the intentionally smoothed forefoot zone ("Smooth forefoot (no toe ridges)").
- Validation (trimesh, 1 mm ray grid, toe zone 4 mm → 24% of length from the tip, ≥ 6 mm inside the outline, residual to a cubic polynomial):
  before v6.1 max 6.9–8.8 mm (toe ridges), after **0.10–0.14 mm** (p99 0.07–0.08 mm); parametric 0.11–0.19 mm. All 20 STLs watertight, 1 body,
  min wall ≥ 1.68 mm. Curvature across the blend zone: max |d²z| 0.05 mm/mm² (was 1.16).
- Screenshots: `screenshots/v6.1-before-toes-*.png`, `v6.1-after-toes-*.png`, `v6.1-*-iso-*.png`, `v6.1-staff-*.png`. Samples: `samples/v6.1-*-{right,left}.stl`.

## v7 (Oct 2026) – Fixifoot insole line: 6 new models (`rules.js` PRODUCTS, `fit.js`, `geometry.js`, `app.js`)
Every model is built on the v6.1 smooth-toe surface (scan path) or the analytic parametric surface. Each product has `model` (real geometry),
`params` (forced clinical settings) and `print` (TPU print settings) – stored in the spec JSON (`print`, `model`, `recommended`) and shown in
staff mode (Product & model card → model geometry + TPU print settings table).

| Model | Geometry (STL) | Print |
|---|---|---|
| **Fixifoot Sport** | 8 → 6 mm (heel → forefoot), 18 mm heel cup, arch +1.5 mm | TPU 95A gyroid 20%, heel shock zone gyroid 35%, 85A soft top 1.2 mm |
| **Fixifoot Everyday** | 4 → 3 mm, 10 mm gentle heel cup, full-contact arch, real ventilation holes | TPU 90A gyroid 25%, 0.16 mm layers |
| **Fixifoot Diabetic Care** | 7 → 6.2 mm (min 6), total contact, 1.4 mm rounded rim, 1.5 mm smooth soft-insert pockets under met heads + hallux | varioShore / TPU 80–85A gyroid 15%, pockets 8% or PORON, 3 mm soft top cover |
| **Fixifoot Work & Stand** | 5.5 → 5 mm, strong arch +3 mm, 16 mm heel cup | TPU 92A, heel + ball cushion zones gyroid 12%, arch 35% |
| **Fixifoot Dress Slim** | 3/4 length (ends 6 mm past met-head line), 3 → 2.2 mm with skived front, met pad, 10 mm cup | TPU 95A solid, 0.12 mm layers |
| **Fixifoot Kids** | 3.2 → 2.2 mm flexible forefoot, arch fill 75%, 14 mm cup; thickness + cup scale with foot length (ref 240 mm) | TPU 85A gyroid 15%, forefoot 10% |

- Rule engine `recommendProduct()`: diabetes → Diabetic Care; foot < 215 mm → Kids; sporty → Sport; 8+ h standing → Work; otherwise Everyday.
  The customer picker shows the recommended model first with a "⭐ Recommended for you" badge; staff mode shows it with a "use it" link.
  A diabetic customer on a non-diabetic model gets a production conflict warning.
- Prescribed met pad is kept on every model; template bases (L90/S90) are disabled for the v7 models (they have their own geometry).
- Samples (right foot): `samples/v7-<model>-right.stl` (kids sample from a 191 mm kid-size scan). Renders: `screenshots/v7-render-<model>.png`.
  Staff screenshots: `screenshots/v7-staff-<model>.png`. Catalog images (model cards): `catalog/<model>.png`; catalog sheet: `catalog/fixifoot-insole-line.png`
  (rendered from the real STLs with Fixifoot colours #0099FF / #015AD8 / #FFD22E).

## v7.1 (Oct 2026) – marketing illustrations for the insole line
- Customer model picker uses marketing illustrations `catalog/<model>-hero.jpg` (960×540, 27–48 KB) with the caption
  "Illustration – your insole is custom-made from your scan". The real STL render (`catalog/<model>.png`) is shown in staff mode as
  "Actual print preview". New catalog sheet: `catalog/fixifoot-insole-line-v2.png`. Service worker cache `fixifoot-demo-v7-1-1`.

## v8 (Oct 2026) – 2-material print files for dual-extrusion printers (`multi.js`)
Each of the 6 line models is split into **two scan-fitted bodies** that fit together exactly. Both bodies are cut from one shared 2D plan of the sole, so the
interface surface uses the same vertices in both files: no gap, no overlap. Each body is a closed, consistently oriented mesh.

| Model | Extruder 1 | Extruder 2 | How it is split |
|---|---|---|---|
| Sport | Black TPU 95A base | Blue TPU 85A top layer 1.8 mm + heel cup | Layers. The base has a hexagonal lattice (1.6 mm ribs) in the heel and open windows in the heel side walls. |
| Everyday | White TPU 90A base | Light-blue TPU 85A top 1.5 mm | Layers. Ventilation holes go through both bodies. |
| Diabetic | White soft TPU / varioShore base | Extra-soft inserts (ball, big toe, medial arch band) | Inserts. They fill the pockets full depth and sit flush with the top. |
| Work | Grey TPU 95A/92A shell | Yellow TPU 85A hex cushions | Inserts. Hexagonal windows (2 mm ribs) in the heel and forefoot are filled by the cushions. |
| Dress | Nude TPU 95A 3/4 body | Light-nude TPU 85A raised met pad | Inserts. |
| Kids | Orange TPU 90A base | Blue TPU 85A top 1.5 mm | Layers. |

- **Layer split.** The top layer thickness is measured perpendicular to the surface (slope-compensated), so the heel-cup walls keep their thickness. The base is never thinner than 1.2 mm where the sole is at least 2.4 mm thick.
- **Staff → "2-material print" card.**
  - Download 2-material 3MF (Right/Left).
  - STL per body (Right/Left).
  - A 2-colour view toggle.
  - A body/extruder table with minimum thicknesses.
  - The render from the actual file.
  - The single-STL buttons are unchanged.
- **3MF contents.**
  - Core spec: basematerials with names and display colours, one mesh object per body, and an assembly object as the build item.
  - `Metadata/model_settings.config`: Orca/Bambu parts with extruder 1/2.
  - `Metadata/Slic3r_PE_model.config`: PrusaSlicer volumes with extruder.
  - `Metadata/fixifoot_print_settings.json`, plus a `fixifoot:printSettings` metadata entry.
- **Samples and images.**
  - Samples: `samples/v8-<model>-right.3mf`.
  - Renders from the real 3MF: `catalog/<model>-actual.png`.
  - Comparison sheet: `catalog/hero-vs-actual.png`.
  - Service worker cache: `fixifoot-demo-v8`.

## v8.1 (Oct 2026) – sandal illustrations + thin-toe fix
- **Picker cards:** the flip-flop and slide cards now use marketing illustrations: `catalog/flipflop-hero.jpg` (Arch Flip-Flop) and `catalog/slide-hero.jpg` (Lattice Slide). Each card has the caption "Illustration – your product is custom-made from your scan".
- **Custom Scan Flip-Flop image:** there is no separate contoured/scan flip-flop card, so `catalog/flipflop-scan-hero.jpg` is a small detail thumbnail on the flip-flop card. Tapping it swaps the two images. The old photos are kept as `photo`.
- **Collection sheet:** `catalog/fixifoot-collection-catalog.png` added.
- **Thin-toe fix:** the Everyday and Kids generic-size (no scan) builds now keep at least 2.4 mm total thickness (`model.minTotal`), raised only at the toe tip and edge. Each of the two layers therefore stays at least 1.2 mm.
- **Cache:** service worker cache `fixifoot-demo-v8-1`.

## v8.2 (Oct 2026) – correct left/right foot view + clean insole outline
- **3D foot preview (Both view).**
  - **What was wrong:** the Right foot was placed on −x and the default camera looked from the toes (facing the person). The result was a mirror image: the foot labelled Left was on the left with its big toe pointing outward.
  - **Fix:** the right foot is now on +x, and the default 3D view looks from behind/above, the way the person sees their own feet. Left is on the left, Right on the right, big toes on the inside. Top and Back presets match this; Front and Bottom are true facing/underneath views.
  - **Unchanged:** the single-foot views, the Inside/Outside presets and the 2D pressure map were already correct.
- **Left/right in the insole files.** The geometry and exports (STL, 3MF, per-body STL) were already correct for every case tested: demo feet, an uploaded right scan and an uploaded left scan. The medial arch is on the inside and right = right.
- **Insole outline (`geometry.insoleShape`).** A new classic insole-last shape: narrow rounded heel, gentle arch waist (deeper on the medial side), widest at the metatarsal heads, rounded toe with the apex slightly medial.
  - The generic/parametric insoles, flip-flop and slide soles all use it.
  - Scan-based soles now use the same shape (`fit.insoleFrame`), laid on the scanned heel→ball axis and scaled to the scanned ball width, heel width and length. The raw silhouette was used before.
  - The 3/4 models get rounded front corners.
  - Screenshots: `screenshots/v8.2-outline-before.png`, `-after.png`, `-left-right.png`.
- **Service worker cache:** `fixifoot-demo-v8-2`.

## v9 (Oct 2026) – design first, then scan
Customers now pick and design their product **before** the scan ("sell the design first").

**Customer flow:** Welcome → **Design my pair** → Catalog (all 9 products with photo, tagline, default colours and price) → Designer → Summary card (design + price) → **Scan my feet** (right, then left) → questions → results → order.
- **Catalog** (`rules.js` `CATALOG`): Everyday, Sport, Work & Stand, Diabetic Care, Dress, Kids, Arch Flip-Flop, Custom Scan Flip-Flop, Lattice Slide.
- **Designer:** live 3D preview of the real product geometry (generic EU 41, or the chosen size), colours update instantly. Pick a colour for extruder 1 (base / sole) and extruder 2 (top layer / inserts / strap) from 12 TPU filament colours (`PALETTE`): Black, White, Grey, Fixifoot Blue #0099FF, Light blue, Orange, Yellow, Olive, Beige/Nude, Red, Pink, Purple. Optional initials (max 6: A–Z, 0–9, & . - '). Optional size (otherwise the scan measures it).
- **Price:** ₱9,999 for every product by default. To change it, staff open **💲 Prices** (saved on the device in `localStorage.fxPrices_v1`), or set `window.FIXI_PRICES = { default: 9999, sport: 8999, … }` in `config.js`. Priority: device setting > config.js > 9,999.
- **After the scan** the chosen design is fitted to the scan. If the rule engine prefers another model (e.g. diabetes → Diabetic Care), a gentle tip offers "Switch (keep my colours)" or "Keep". The customer's choice stays unless they or staff change it (`design.changedBy`, `design.keptSuggestion`).
- **Staff:** the scan-first path is still there ("Staff: scan first (classic flow)" on the welcome screen in staff mode). The staff panel shows a **🎨 Customer design** card (edit the design) and the price editor.

**Engraving (real geometry, `engrave.js`):** letters are 8 mm high (down to 6.5 mm if needed), 0.6 mm deep. Every stroke and gap is at least 1.2 mm (morphological close + open, r = 0.6 mm). They are placed on the heel (Work: midfoot between the cushions; Diabetic: on the underside, so the top stays smooth) and read correctly from above with the toes pointing up.
- Two-material insoles: the top layer is cut through in the letter shapes and the base colour fills them up to 0.6 mm below the surface, giving a two-colour inlay.
- Single STLs: a 0.6 mm pocket.
- No lattice cells or holes are placed under the letters, so the letter floor stays solid.
- The slide lattice gets a solid label patch.
- Every engraved body is checked closed in float32 (`closedF32`) and repaired by micro-simplify if needed (`ensureClosed`).

**Saved with the order:** `spec.design` (product, colours per extruder with hex/name/material, initials plus engraving info, size, price) and `spec.price`. The 3MF material names, displaycolor and `fixifoot_print_settings.json` use the chosen colours. Cloud: migration `supabase/migrations/20261004160000_orders_design.sql` adds nullable `design jsonb, price_php, engraving_text (≤6), color_ext1, color_ext2` to `orders`. It is additive only and RLS is unchanged (staff-only policies; anon is denied).

**Validation** (`samples/v9-validation.json`, test design Sport black/orange "JP"): 32 STLs, all watertight, consistent winding, volumes. Min vertical wall 1.5 mm, no parts narrower than 1.2 mm, min rib 1.77 mm. Two-body interface overlap ≤ 0.02 mm³. Left/right correct. 3MF: 2 objects / 1 build item, no lib3mf warnings. Screenshots: `screenshots/v9-*.png` (iPhone 13 size).
- Note: the Arch and Custom Scan flip-flops share the scan-fitted sole geometry.
- Note: flip-flop and slide colours are recorded in the spec; they print as a single sole STL.

## v10 (Oct 2026) – production mode + PDF receipt
**No demo mode for customers.** The DEMO badge, “(demo)” texts, simulated camera scan and default demo feet are gone. Old sample customers (C-DEMO*) are removed from the device.
- **Scan step:** customers upload a real 3D scan, right foot first, then left. STL, OBJ and PLY are accepted (e.g. exported from KIRI Engine), and a short “how to scan with your phone” guide is shown.
- **Staff fallback:** 📏 Manual measurements. Staff enter length, width at the ball and arch type per foot. The 3D foot is then labelled “illustration from measurements” (the CC0 foot mesh is used only as an illustration, never as “your scan”). Orders and the spec say “manual measurements”.
- **Staff test tool:** Settings → “Test tools” turns on 🧪 “Test with sample feet”. It is hidden for customers. Sample feet are marked as test data everywhere (spec `testData: true`, receipt “TEST – NOT A REAL ORDER”). The URL hooks `?demo=` and `?staff=1` only work on offline devices or with test tools on.
- **Staff access:** cloud sign-in. The shop PIN (`window.FIXI_STAFF_PIN`, default 1234, no longer shown on screen) is only offered when the cloud is unreachable (health check) or not configured, together with a note to staff that data stays on the device until it is uploaded.

**PDF receipt** (`receipt.js`, generated in the browser, works offline and in the standalone file):
- Created when an order is completed (thank-you screen) and from Customers → customer → 🧾 Receipt on every order.
- Content: logo, Fixifoot Philippines, fixifoot.ph, receipt/order no. (FXF-…), date/time in Asia/Manila, customer name, mobile and email. Items: product, colours per part, initials, size, foot length L/R, unit price, qty 1 pair. Then subtotal, discount, total in ₱, payment method (Cash, GCash, Maya, Card, Bank transfer), paid/unpaid, staff name, notes, thank-you + TPU care instructions, and the footer “Comfort product, not a medical device”.
- Buttons: Download PDF · Share (Web Share API with the PDF file; falls back to download) · Print.
- **Business details** (Staff → Settings, or `window.FIXI_BUSINESS = { name, address, tin, phone, email }` in config.js) are blank by default; no TIN is invented. Without name, address and TIN the PDF is titled **Acknowledgement Receipt** and says it is not an official BIR receipt.
- **Cloud:** migration `20261004180000_orders_payment.sql` adds optional `payment_method` (checked list), `paid`, `discount` (≥0) and `receipt_no` (unique when set) to `orders`, and allows the scan sources `manual` and `sample`. RLS is unchanged.
- Sample: `samples/v10-receipt-sample.pdf` (TEST customer); page 1 is shown in `screenshots/v10-receipt.png`. Scan step screenshots: `screenshots/v10-*.png`.


## v11 (Oct 2026) – CRM upgrade (staff mode)
Staff dashboard → **Customers & orders** now has five tabs. The layout is built for phones: tabs and the board scroll sideways and buttons are large enough to tap.
- **Customers**: search by name, phone, email or order no. The **Filters** panel adds tag, product, status and a from/to date range; the same filters apply to every tab and to the exports. Tap a customer to open the **customer card**:
  - editable name, mobile and email; tags (**Diabetic**, **Athlete**, **VIP** plus custom tags); internal staff notes
  - every order with a status selector and dated status trail, plus 🧾 receipt (PDF download, share or print)
  - scan history by date with **View 3D**. The original scan is loaded from cloud storage when it exists; otherwise the viewer shows a labelled illustration built from the measurements.
- **One-tap reorder** from the saved scan: **↻ Same again**, or **🎨 Change product / colours** to pick a product, a colour for each part, and initials. Both regenerate the print files and spec with no new scan and record the order as `reorder`.
- **Orders**: a **Board** (kanban: New → Printing → Ready for pickup → Delivered, plus Cancelled, with ◀ / ▶ / ✕ move buttons) and a **List** with a status selector. Every change is stamped `{status, at, by}`.
- **Reminders**: orders *Ready for pickup* for more than 3 days (Call / SMS / Delivered ✓), and customers whose last order was 6–12 months ago (replacement due, with a Reorder button).
- **Reports**: revenue, order count, average order, and unpaid total; sales by day and by month; top products; revenue by payment method. Reports count real orders only, excluding cancelled orders and any test or sample-scan order (customer name containing "TEST", or sample feet). Revenue is price − discount, and dates are in Philippine time.
- **Export**: customers CSV, orders CSV (UTF-8, opens in Excel or Sheets) and an `.xlsx` workbook with *Customers* and *Orders* sheets. All exports follow the current filters. Sample: `samples/v11-crm-export-sample.xlsx`.

Database: migration `supabase/migrations/20261004190000_crm_status_tags.sql` adds:
- `customers.tags text[]` (the existing `notes` column holds staff notes)
- `orders.status_history jsonb` and `orders.status_updated_at`
- trigger `orders_status_stamp`, which records each status change on the server with `auth.uid()`
- indexes on status, created_at and tags

RLS is unchanged: staff read/insert/update, admins delete, and anonymous users have no access. Screenshots `screenshots/v11-*.png` were taken with local sample data (Customer 01–08 plus one TEST customer to show it is left out of reports); no sample data was written to the cloud.

## v11.1 (Oct 2026) – Continue without scan
- **Customers** (no staff login needed) can tap **Continue without scan →** on the scan-upload screen. They then enter:
  - shoe size in **EU / US Men / US Women / UK**, or foot length in **cm**. The size applies to both feet by default; tick "left foot is a different size" to enter each foot.
  - optional width: narrow / normal / wide
  - arch type (flat / normal / high), picked from simple footprint pictures
- The flow then continues as usual: preview, analysis, questions, results and order. The 3D foot is labelled *"illustration from your measurements – scan pending"*, and the order screen and thank-you card explain that a scan will be taken before printing.
- **Scan pending** marking:
  - set on the order and the customer (feet source `self`; staff manual measurements count too)
  - shown as a badge in the CRM list, on the board and in the order list
  - **Scan** filter: pending / has 3D scan
  - **📷 Needs scan** list in Reminders
  - a column in the CSV / Excel exports
- **Add scan** button on the customer card (also in Reminders):
  - staff upload the STL/OBJ/PLY files (side detected automatically)
  - the pending order's print files and spec are rebuilt from the scan, keeping the same order number and design
  - the flag is cleared; when signed in to the cloud, the scan and the regenerated STLs are uploaded
- **Staff print files from measurements** can still be downloaded. The dashboard shows "⚠ Approximate fit – scan recommended", file names end in `-APPROX`, and the spec carries `scanPending` and `fitWarning`.
- **Database:** migration `supabase/migrations/20261004200000_scan_pending.sql` adds:
  - `customers.scan_pending` and `orders.scan_pending` (boolean, default false), with partial indexes
  - scan source `self`

  RLS is unchanged.
- Screenshots: `screenshots/v11.1-*.png`.
