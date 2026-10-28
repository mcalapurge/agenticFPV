# agenticFPV — Plan & Progress

Web-based FPV drone simulator (Three.js + Vite) with Betaflight-style flight controller,
USB gamepad / RC-transmitter input, and an abandoned-buildings map.

Legend: `[x]` done · `[~]` in progress · `[ ]` todo

## Architecture

| Area | File(s) | Notes |
|------|---------|-------|
| Config / persistence | `src/config.js` | Defaults, deep-merge, localStorage, import/export JSON |
| Rates | `src/sim/rates.js` | Betaflight *Actual* + *Betaflight* rate formulas, throttle mid/expo |
| Flight controller | `src/sim/flightController.js` | RC smoothing, gyro/D-term LPF, PID+FF (BF scaling), TPA, airmode mixer, angle mode |
| Quad physics | `src/sim/quad.js` | Rigid body, per-motor lag, thrust ∝ rpm², prop inflow loss, drag, prop-wash, battery sag |
| Collision | `src/sim/collision.js` | Sphere vs oriented boxes, spatial hash broadphase |
| World | `src/world/*.js` | Procedural textures, abandoned buildings, rubble, containers, gates |
| Input | `src/input/input.js` | Gamepad API, axis mapping, calibration, auto-detect, arm switch, keyboard fallback |
| UI | `src/ui/*.js` | Settings panel (tabs), rate curve preview, OSD, stick overlay |
| Entry | `src/main.js` | Renderer, cameras (FPV/chase/LOS), fixed-step 1 kHz loop |

## Milestones

- [x] **M1 Scaffold** — Vite project, plan, rendering a scene
- [x] **M2 Physics core** — quad dynamics, motors, aero, BF rates, PID + mixer, headless tests (hover, step response)
- [x] **M3 Input** — gamepad/RC mapping, calibration, arming, keyboard fallback
- [x] **M4 Map** — abandoned buildings, textures, colliders, collision response
- [x] **M5 UI** — settings panel (Controller / Rates / PIDs / Filters / Physics / Camera / Graphics), persistence, OSD
- [x] **M6 Polish** — cameras, gates + lap timer, prop-wash, battery, GH Pages deploy workflow, README
- [x] **M7 Verify** — headless browser smoke test + screenshot, physics tests green

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
