# agenticFPV

A browser-based FPV drone simulator in the spirit of Velocidrone and Liftoff. It has:

- A Betaflight-style flight controller.
- Real USB RC-transmitter and gamepad support.
- Six quad classes.
- Race, practice and track-editor modes.
- Synthesised motor audio and simulated analog or digital video.
- An abandoned-industrial map.

It's built on Three.js, and everything works with no downloaded assets.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

```bash
npm test               # headless physics, preset-tune, and Betaflight-CLI tests
npm run build          # static build in dist/ (relative paths, host anywhere)
npm run fetch-assets   # optional: download CC0 Poly Haven photo textures (see below)
```

Pushing to `main` deploys the build to GitHub Pages through `.github/workflows/pages.yml`. To turn it on,
go to **Settings → Pages → Source: GitHub Actions**.

## Features

| Area | What you get |
|------|--------------|
| **Flight model** | 1 kHz rigid body. Each motor has spin-up/spin-down lag, and thrust scales with rpm². Also: prop inflow loss, yaw torque from prop drag and rotor acceleration, per-axis drag plus rotor H-force drag, prop-wash turbulence, battery sag, wind with gusts. |
| **Collisions** | The quad collides as 6 spheres (4 props, the body and the battery) with rigid-body impulses and friction, so it tumbles and comes to rest realistically. Crash-on-impact is optional. |
| **Turtle mode** | Betaflight crash-flip with reversible motors. It is latched at arming (switch or `T`), then you push the sticks toward the side you want to flip. |
| **Flight controller** | Betaflight scaling for P/I/D/FF. RC smoothing, gyro and D-term low-pass filters, I-term relax, TPA, airmode with an activation threshold, angle mode. Actual and classic Betaflight rates. |
| **Betaflight import** | Paste a CLI `diff all` (PIDs tab) to import PIDs, rates, TPA, filters, idle and airmode from your real quad. |
| **Quad classes** | 5" freestyle, 5" race, 3" toothpick, 3" cinewhoop, 7" long range and 65 mm tiny whoop. Each class has a tune checked by tests and its own detailed procedural model: twisted-airfoil props, motor bells, ducts, FC stack, a strapped LiPo. |
| **Game modes** | Free fly, Practice (endless laps, a ghost of your personal best, split deltas), Race (countdown, holeshot, N laps, missed-gate warnings, results card, local leaderboard), Track editor. |
| **Tracks** | Works Circuit, Warehouse Sprint and Tower Dive (with tilted and dive gates), plus your own tracks. Tracks can be imported and exported as JSON. |
| **Replay** | DVR of the last 90 s (`P`): seek, change speed, pause, switch camera. |
| **Audio** | WebAudio synthesis driven by simulated rpm: motor whine, blade-pass tones, prop noise, prop-wash flutter, wind rush, impacts. |
| **Video** | Fisheye lens, chromatic aberration, vignette. The analog link gets static and breakup; the digital HD link gets blocking and freezes. Both depend on distance and on the number of walls between you and the quad. VTX power is selectable. The OSD shows RSSI or LQ. |
| **Environment** | Midday, golden hour, overcast, dusk and night (with street lamps). Lighting uses CC0 Poly Haven HDRIs. |
| **Cameras** | FPV (FOV and uptilt adjustable), chase, line of sight, orbit. |

## Controllers

1. Put your radio in **USB Joystick (HID)** mode (EdgeTX/OpenTX: plug in → *USB Joystick*). A gamepad also works.
2. Press any stick or button so the browser exposes the device.
3. Press **Esc** → **Controller** → **Run calibration wizard**. The wizard detects axes and their
   directions, records stick ranges and centres, and learns your arm switch. You can also map an
   angle-mode switch and a turtle switch.
4. Arming works like Betaflight: switch on with throttle low.

Keyboard fallback:

- **Throttle:** `W`/`S`, and `X` cuts it.
- **Yaw:** `A`/`D`.
- **Pitch/roll:** arrow keys.
- **Arm:** `Space`.
- **Turtle mode:** `T`.

Angle mode (`M`) makes keyboard flying much easier.

| Key | Action |
|-----|--------|
| `Esc` / `Tab` | Settings (pauses) |
| `R` | Reset / restart race |
| `C` | Camera: FPV → chase → LOS → orbit |
| `M` | Acro ↔ Angle |
| `T` | Turtle mode (takes effect when you next arm) |
| `P` | Replay (`←`/`→` seek, `↑`/`↓` speed, `Space` pause) |
| `G` / `Backspace` | Track editor: place a gate ahead of the quad / remove the last gate |
| `B` | Blackbox trace (setpoint vs gyro) |
| `H` | Help |

## Textures & assets

Everything ships procedurally, so the repo contains no binary art:

- **Materials:** tileable fBm heightfields generate albedo, normal and roughness maps for concrete,
  brick, asphalt, rusted and painted corrugated metal, and wood (`src/world/pbr.js`).
- **HDRIs:** CC0 [Poly Haven](https://polyhaven.com) images bundled through
  [`@pmndrs/assets`](https://github.com/pmndrs/assets) (CC0).

**Photo textures (optional).** `npm run fetch-assets` downloads CC0 PBR texture sets from Poly Haven
into `public/textures/`. It also writes `manifest.json` and `CREDITS.md` there. On the next load the game
uses them automatically; without them it falls back to the procedural textures.

## Layout

```
src/
  main.js                 renderer, cameras, loop, arming, video-link sim
  config.js               defaults + persistence
  sim/                    rates, filters, flight controller, quad physics, collision, presets, BF CLI import
  game/                   tracks + records, game modes/race logic, replay
  world/                  map builder, PBR texture generator, quad models, decal/alpha textures
  render/                 environment (sky, sun, IBL, time of day), video post-FX
  audio/motorAudio.js     WebAudio motor synth
  input/input.js          gamepad/RC mapping, calibration wizard, keyboard
  ui/                     settings menu, OSD, styles
scripts/fetch-assets.mjs  optional CC0 texture download
test/                     node:test suites
PLAN.md                   milestones + progress log
```
