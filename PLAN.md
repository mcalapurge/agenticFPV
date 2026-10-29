# agenticFPV — Plan & Progress

Web-based FPV drone simulator (TypeScript, Three.js, React 19, Vite) with Betaflight-style flight controller,
USB gamepad / RC-transmitter input, and an abandoned-buildings map.

Legend: `[x]` done · `[~]` in progress · `[ ]` todo

## Architecture

| Area                 | File(s)                                       | Notes                                                                                      |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Config / persistence | `src/state/configSchema.ts`, `configStore.ts` | Zod schema (type + defaults + validation), Zustand/Immer store, localStorage, v1 migration |
| Engine entry         | `src/engine/Simulator.ts`                     | Renderer, cameras (FPV/chase/LOS/orbit), fixed-step 1 kHz loop, arming, video link         |
| Rates                | `src/engine/sim/rates.ts`                     | Betaflight _Actual_ + _Betaflight_ rate formulas, throttle mid/expo                        |
| Flight controller    | `src/engine/sim/flightController.ts`          | RC smoothing, gyro/D-term LPF, PID+FF (BF scaling), TPA, airmode mixer, angle mode         |
| Quad physics         | `src/engine/sim/quad.ts`                      | Rigid body, per-motor lag, thrust ∝ rpm², prop inflow loss, drag, prop-wash, battery sag   |
| Collision            | `src/engine/sim/collision.ts`                 | Sphere vs oriented boxes, spatial hash broadphase, raycast, occluder count                 |
| Game                 | `src/engine/game/*.ts`                        | Tracks + records, pure `RaceSession` state machine, gates, replay, `Game` orchestrator     |
| World / render       | `src/engine/world/*.ts`, `render/*.ts`        | Map, procedural PBR, quad models, environment, post-FX, prop-wash dust, grass wind         |
| Input                | `src/engine/input/input.ts`                   | Gamepad API, axis mapping, pure calibration wizard, arm switch, keyboard fallback          |
| UI                   | `src/ui/**/*.tsx`                             | React 19: settings menu (tabs), rate curve preview, OSD, stick overlay, overlays           |
| Tests                | `test/unit`, `test/component`, `e2e`          | Vitest (node + jsdom), Testing Library, Playwright                                         |

## Milestones

- [x] **M1 Scaffold** — Vite project, plan, rendering a scene
- [x] **M2 Physics core** — quad dynamics, motors, aero, BF rates, PID + mixer, headless tests (hover, step response)
- [x] **M3 Input** — gamepad/RC mapping, calibration, arming, keyboard fallback
- [x] **M4 Map** — abandoned buildings, textures, colliders, collision response
- [x] **M5 UI** — settings panel (Controller / Rates / PIDs / Filters / Physics / Camera / Graphics), persistence, OSD
- [x] **M6 Polish** — cameras, gates + lap timer, prop-wash, battery, GH Pages deploy workflow, README
- [x] **M7 Verify** — headless browser smoke test + screenshot, physics tests green

## Phase 2 — Velocidrone-style features (no multiplayer)

- [x] **M8 Contact physics + turtle + wind** — multi-point rigid-body contacts (quad tips/rests realistically),
      reversible motors, Betaflight turtle mode (switch / `T`), wind + gusts
- [x] **M9 Quad classes + detailed models** — presets (5" race, 5" freestyle, 3" toothpick, cinewhoop,
      7" long range, 65mm tiny whoop) with high-poly procedural models (twisted 3-blade props, motor bells, ducts…)
- [x] **M10 Motor audio** — WebAudio synth: per-motor whine + blade-pass tones, prop wash, impacts, volume
- [x] **M11 Game modes** — tracks (3 built-in + custom), track editor, race mode (countdown, laps, missed gates,
      results), time-trial ghost of best lap, local leaderboards, DVR replay
- [x] **M12 Video & environment** — post-FX (fisheye, analog static/breakup by range & walls, digital HD look),
      time-of-day presets, CC0 HDRI image-based lighting (@pmndrs/assets → Poly Haven)
- [x] **M13 Visual upgrade** — PBR procedural textures (normal + roughness), detailed props (barrels, pallets,
      rebar, stairs, fences, lamps, tyres), optional `npm run fetch-assets` for CC0 Poly Haven textures
- [x] **M14 Betaflight CLI import, UI, docs, verification**

## Phase 3 — TypeScript + modern stack (branch `claude/typescript-modernization`)

- [x] **M15 Toolchain** — TypeScript (strict), ESLint flat config + typescript-eslint + React Hooks, Prettier, Vitest, Playwright
- [x] **M16 State** — Zod config schema as the single source of truth; Zustand stores for config/UI/engine
- [x] **M17 Engine port** — every engine module in strict TS; `Simulator` class; pure, testable `RaceSession`,
      `CalibrationWizard`, video-link and audio helpers
- [x] **M18 React UI** — settings menu, HUD and overlays rebuilt in React 19
- [x] **M19 Tests** — Vitest unit + component suites, Playwright end-to-end + visual suites, CI workflow

Note: asset hosts api.polyhaven.com / dl.polyhaven.org / ambientcg.com are blocked by this cloud
environment's network policy, so real photo textures are fetched by a script the user runs locally.

## Progress log

- **M1–M2** Vite + Three.js scaffold; 1 kHz physics/PID loop. Headless tests: hover ≈30% throttle,
  roll/pitch step overshoot ≈10%, yaw ≈18%, top speed ≈130 km/h, flips recover cleanly. Added BF I-term relax,
  rotor-inertia yaw torque, airmode activation threshold.
- **M3** Gamepad API mapping, 11-step calibration wizard (auto-detects axes, direction, ranges, arm switch),
  presets (EdgeTX/OpenTX joystick, Xbox/PS gamepad), BF-style arming (throttle low), keyboard fallback.
- **M4** "Abandoned Works" map: 5-floor concrete skeleton, brick warehouse with collapsed roof, 9-floor
  blown-out tower + water tank, L-shaped ruin with collapsed corner, container yard, smokestack + boiler
  house, pipe bridge, broken perimeter walls, rubble, power lines, raycast-placed graffiti. ~1400 OBB colliders
  in a spatial hash.
- **M5** Settings menu (Controller / Rates w/ live curve / PIDs w/ simplified sliders / Filters / Physics w/
  derived T:W / Camera & Video / Help), auto-saved to localStorage, JSON import/export. BF-style OSD, stick
  overlay, blackbox trace (B).
- **M6** Race gates (9) with lap timer and next-gate highlight, FPV/chase/LOS cameras, prop-wash, battery sag,
  GitHub Pages workflow, README.
- **M7** Playwright smoke tests in headless Chromium: page loads with no errors; keyboard arm and take-off
  work; all 9 gate paths are clear of colliders; a lap is timed correctly; menu tabs render.
  `npm test` passes 8/8.

## Ideas / next steps

- Mouse-free "quick tune" presets (e.g. 3", 5" race, 7" long range, cinewhoop).
- Turtle mode (flip over after a crash without resetting).
- Simulated analog video noise and breakup at range or behind walls.
- More maps, a gate editor, and ghost replays.
- Tests that pin the arming state machine and the lap-gate crossing logic.
- **M8** Quad collides as 6 spheres (4 props + body + battery) with rigid-body impulses + Coulomb friction —
  tumbles and settles flat. Reversible motors + BF turtle mode (latched at arm; switch or `T`). Wind with
  Ornstein–Uhlenbeck gusts. Tests: rest after drop, turtle flip upright, wind drift (11/11 pass).
- **M9** 6 quad classes (5" freestyle/race, 3" toothpick, 3" cinewhoop, 7" LR, 65mm whoop), each with a
  PID tune verified by `test/presets.test.js` (hover 24–54%, step overshoot ≤23%, no oscillation).
  High-poly procedural models: extruded carbon arms w/ slots + screw holes, lathe motor bells, twisted
  airfoil blades (2/3/4/5-blade), rpm-driven blur discs, ducts, FC stack, camera w/ lens, strapped
  labelled LiPo + XT60 lead, antenna, GPS. New Quad tab + orbit camera.
- **M10** WebAudio synth driven by simulated rpm: per-motor sawtooth whine at electrical freq (7 pole pairs)
  - blade-pass tones, band-passed prop noise, LFO prop-wash flutter, airspeed wind rush, impact crack/thump,
    distance attenuation + low-pass in third-person views. Volume controls in Camera/Video/Audio tab.
- **M11** Game modes: Free fly / Practice / Race / Track editor. 3 built-in tracks (Works Circuit, Warehouse
  Sprint, Tower Dive incl. tilted + dive gates), all verified clear of colliders. Padded striped gates with
  number boards + colliders; next/next-next highlights + off-screen pointer; holeshot, laps, split deltas vs PB,
  missed-gate warnings, results card, local leaderboard (top 10 per track × quad), PB ghost replay,
  90 s DVR replay (P: seek/speed/pause/camera). Editor: G place (dive if nose down), Backspace undo,
  save/import/export JSON. Smoke-tested: race of 2 laps → results + PB; replay.
- **M12** Post-FX pass: fisheye lens, chromatic aberration, vignette; analog link (static, desaturation,
  tearing/rolling breakup) or digital HD link (blocking, freeze, signal loss) driven by distance + number of
  walls between pilot and quad (segment-vs-OBB occlusion query), VTX power setting, RSSI/LQ on OSD.
  Time of day: midday, golden hour, overcast, dusk, night (stars + street lamps with nearest-6 point lights).
  IBL from CC0 Poly Haven HDRIs bundled via @pmndrs/assets.
- **M13** Procedural PBR materials (tileable fBm heightfields → albedo/normal/roughness): concrete ×3, brick
  with mortar + chips, sparse-cracked asphalt with weeds, corrugated painted/rusty metal ×4, wood.
  Props: ribbed lathe oil drums (some tipped), stacked pallets, tyre stacks, cones, dead trees, stair flights,
  exposed rebar, chain-link fencing (alpha, colliders), 12 street lamps, 1.8k instanced weed tufts.
  `npm run fetch-assets` pulls CC0 Poly Haven textures into public/textures + manifest (verified against a mock
  API; game auto-switches to photo textures when present, falls back to procedural otherwise).
- **M14** Betaflight CLI `diff all`/`dump` import (active PID + rate profile; PIDs/FF, TPA, filters, idle,
  airmode, Actual/BF rates, throttle curve) with unit test + PIDs-tab UI. Help/README updated. Turtle test made
  deterministic (release stick when flipped). Final browser run: no console errors; editor place/save; PB ghost
  shows on next lap; CLI import via UI; analog/digital link degrade behind walls. Budget: ~177k tris, ~300
  draws, physics ≈30 ms CPU per simulated second. `npm test`: 18/18 (stable over 6 runs).

## Known limitations / next ideas

- Headless CI renders with SwiftShader (~6 fps), so in-browser checks are scripted; real-GPU frame rate is
  not measured here.
- Real photo textures need `npm run fetch-assets` on a machine with internet access (Poly Haven was not
  reachable from the build environment).
- Ideas: merge quad-model meshes to cut draw calls, more maps, multi-quad ghost comparison, VR/goggle output,
  FPV-view props option, gyro noise spectrum / RPM filter simulation.
- **GPU check** WebGL GPU detection (`src/render/gpuInfo.js`): software-renderer warning banner (SwiftShader,
  llvmpipe, Microsoft Basic Render…) with fix instructions; GPU name in the Video tab; `F` toggles an OSD
  readout of FPS / frame time / physics ms / render-submit ms. Measured: physics ≈6–11 µs per 1 kHz step
  (~1% of one core for the player quad; 100 quads ≈18%), so physics stays on the CPU.
- **Effects** Prop-wash dust as a GPU particle system (6k ring buffer; motion/fade in the vertex shader, CPU only
  writes spawns). Wash direction follows body -up; collision raycast finds ground/slab/roof within ~2–4 prop
  diameters; strength ∝ thrust × proximity²; grass clippings over grass patches; crash debris bursts. Grass:
  shader-patched instanced cards (weeds + new dense tall grass on patches) sway with wind and push/flatten/flutter
  under the wash. Verified: raycast unit test; patched shader compiled on both grass meshes; forced-wash diff
  confined to the wash radius; screenshots over asphalt/grass/impact.
