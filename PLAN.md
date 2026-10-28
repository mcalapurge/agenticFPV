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

- [ ] **M1 Scaffold** — Vite project, plan, rendering a scene
- [ ] **M2 Physics core** — quad dynamics, motors, aero, BF rates, PID + mixer, headless tests (hover, step response)
- [ ] **M3 Input** — gamepad/RC mapping, calibration, arming, keyboard fallback
- [ ] **M4 Map** — abandoned buildings, textures, colliders, collision response
- [ ] **M5 UI** — settings panel (Controller / Rates / PIDs / Filters / Physics / Camera / Graphics), persistence, OSD
- [ ] **M6 Polish** — cameras, gates + lap timer, prop-wash, battery, GH Pages deploy workflow, README
- [ ] **M7 Verify** — headless browser smoke test + screenshot, physics tests green

## Progress log

