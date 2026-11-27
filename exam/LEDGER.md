# Version Ledger: SVG to 3D Tool

Exam: EXAM.md frozen 2026-11-26, hashes in HASHES.txt.
Baseline: three hand-built proof pages (test4, test4b, test4c), no SVG parsing.

## v1, 2026-11-26
Lever: whole tool built (real SVG parsing via per-element SVGLoader,
evenodd and nonzero hole classification, stroke expansion, recessed
layer centring, procedural wood, metal, stone textures, orbit view,
PNG and GLB export, exam harness mode).
Capture: renders/report-v1.json, renders/e1-v1.png to e8-v1.png, all viewed.

- E1 shield: PASS G1 to G6. 2 meshes, no warnings.
- E2 castle gate: PASS G1 to G6. Stone texture reads, door and window
  holes see-through, portcullis recessed, star raised. 8 meshes.
- E3 ring and keyhole: FAIL G3. Ring perfect. Keyhole circle see-through
  but the slot region is filled by a dark plug with the slot outline.
  Cause: overlapping-hole merge produced a wrong loop. Plate also reads
  near black (iron tint over dark metal texture), G4 weak but not failed
  on its own. Decision: REJECT as final, fix merge in v2.
- E4 lettering: PASS G1 to G6. R bowl and A counter both see-through
  (R verified in enlarged crop). 2 meshes.
- E5 wave banner: PASS G1 to G6. Wood texture reads, arc curl smooth,
  studs raised. 4 meshes.
- E6 dragon: PASS G1 to G6. Eye hole see-through at all 3 angles,
  silhouette matches flat original. 1 mesh. The builder's predicted
  eye-drop guard never fired.
- E7 snowflake: PASS G1 to G6. All 6 arms, stroke volume real, centre
  stud raised. 43 meshes.
- E8 adversarial: PASS G1 to G6 with the required warning (open subpath
  auto-closed, element 3). Overlapping circles, tiny star, all 24 dots
  present. 29 meshes.

Verdict: v1 is a strong first version, 7 of 8 cases pass. Not production
ready: E3 G3 fails, GLB export not yet validated by parse-back, README
not yet written.

## v2, 2026-11-26
Lever: hole classification for crossing subpaths (one change in
buildFillShapes in src/svg3d.js).
Root cause found by numeric test, not by guessing: the union merge was
provably correct (merged loop area within 0.05 percent of grid union).
The real bug was upstream: the keyhole slot crosses the keyhole circle,
so the slot's first point sat inside two containers and evenodd nesting
counted it as a solid. It was extruded as the dark plug seen in v1.
Fix: a subpath that crosses another is not counted as its container.
Capture: renders/report-v2.json, all viewed for e3, e2, e6.
- E3: PASS G3. Keyhole fully see-through, front and angled. Meshes 3 to 2.
- E2, E6: renders byte-identical to v1 (same sha256), no regression.
- All other cases: identical mesh and triangle counts.
Verdict: KEEP. 8 of 8 exam cases now pass.

## v3, 2026-11-26
Lever: iron material tint compensation (one case in materialFor).
The metal texture base (#43484f) multiplied with the fill tint and
double-darkened iron to near black (combined albedo #10141a for a
#565d66 fill). Tint is now divided by the texture base in linear space
so the combined albedo lands on the requested fill; metalness 0.78 to
0.6, roughness 0.46 to 0.5.
Verified in the v4 capture (v3 and v4 were captured together): E3 plate
reads as brushed grey iron with visible brushing, E2 portcullis bars
read dark brown and are clearer in angled views. Verdict: KEEP.

## v4, 2026-11-26
Lever: default fill handling.
Found by hands-on UI testing, not by the exam: pasting bare path data
built nothing, because an absent fill attribute was treated as no
fill. Per the SVG spec, absent fill means the default fill; only an
explicit fill="none" means unfilled. Fix: explicit none is now the
only skip case; absent fill builds with a neutral grey (#7d8590).
Capture: renders/report-v4.json, full 8 cases, counts identical to v2
for every case; paste test now builds (1 mesh, 44 triangles, no
warnings) and was viewed in the app screenshot.
Verdict: KEEP.

## Production gates, final
- P1 reusable tool, file, paste markup, paste path data, options: PASS.
- P2 orbit view: PASS.
- P3 PNG export: PASS, real download verified (valid PNG, 40,965 bytes
  for E1).
- P4 GLB parse-back: PASS. glb-test.html exported E2 and E3, parsed
  back with GLTFLoader: glTF 2.0, meshes 8 and 2 matching source,
  triangles 1332 and 1944 matching source, materials present. The app
  GLB button download also verified (magic glTF, 132,712 bytes for E1).
- P5 procedural textures wood, metal, stone: PASS, all read in renders.
- P6 README with honest limits: PASS (README.md).
- P7 all 8 exam cases pass in the same version: PASS at v4.

Cold critique at v4 (fresh pass over all renders): no KILL or MODIFY
items open. Minor nits accepted: stroke art is chunky at angles
(documented limit), gold reads bronze in shadow on E1 angled views.
PRODUCTION READY.

## Stress round 2026-11-26 (Rusty: "try more detailed things")
Six detailed designs in stress/ (gears, mandala, knight, ornate key,
tree, ship), captured with stress.html at matched app lighting.
Detail verdicts: gears PASS (teeth, spoke holes, hub pins faithful);
mandala PASS (36 petals in 3 rings, 12 pierced holes, gem centre);
tree PASS (55 leaf circles, 7 raised apples, grass strokes); ship
PASS (sails, rigging, 4 portholes, waves); key PASS after v6 (bow
piercings, collars, teeth, star tag); knight FAILED at v4 on one
detail: recessed breastplate lines buried inside the torso.

- v5 (recessed strokes on host surface): recessed stroke elements now
  find the base fill containing their centre and sit on its front,
  fills unchanged. Key swirls surfaced; knight lines still hidden.
- v6 (bevel-aware placement): probe showed a depth D front face sits
  at D + bevelThickness (torso 28 face at z 31; lines were at 29.74).
  zStart now hostDepth + hostBevelThickness - 0.5. Knight lines span
  z 30.26 to 32.74 and render clearly. Exam regression: all 8 cases
  identical stats to v4, e2 and e7 renders byte-identical.
Stress set: 6 of 6 pass at v6. Tool version is now v6.

## Creation expansion 2026-11-26 (Rusty: a 3D creation tool, not just extrusion)
- v7 data-mode: revolve (LatheGeometry from a half profile, axis at the
  outline's left edge), sphere (sphere scaled to bbox, data-depth as z
  diameter), tube (TubeGeometry along the stroke). Opt-in only; wrong
  element kind warns and falls back to extrusion. Creation tests in
  stress/c1-vase.svg, c2-orb.svg, c3-vine.svg, all viewed.
- v8 tube placement: tubes first sat at depth/2 and buried inside a
  same-depth solid (vine in the arch). Tubes now ride on the front
  surface: axis at baseDepth + bevelThickness - radius*0.35. Vine and
  tendril render fully on the arch face.
- App is now a scene builder: parts list (each loaded SVG is a part),
  primitives (sphere, box, cylinder, cone, torus), per-part X/Y,
  rotation, scale, colour, duplicate, delete, ground grid toggle,
  scene-wide PNG/GLB export. Verified by driving the UI: shield part +
  revolved vase part (moved, scaled 1.3) + sphere (moved) + torus;
  exported scene.glb 371,000 bytes, 5 meshes, 12 nodes, parses as glTF.
- Regression: frozen exam at v7 identical stats to v4 on all 8 cases,
  e2 render byte-identical. Tool version is now v8.

## v9 (2026-11-26): layered scenes + animation
One lever set, all opt-in: data-layered / Layered checkbox (thin
sheets stacked in document order), data-anim + paper-class animation
pivots in the converter, live animation engine, animated GLB export
and WebM recording in the app, layered-cottage sample. Exam e1 and e2
renders byte-identical to v1/v4. Sample verified headless: 32
animated elements, viewer frames differ over time, exported GLB
parses back with 1 animation / 96 channels.
