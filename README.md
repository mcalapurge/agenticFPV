# agenticFPV

A browser-based FPV drone simulator with a Betaflight-style flight controller, real USB RC-transmitter or
gamepad support, and an abandoned-industrial map to rip around in. It's built with Three.js and has no
external assets: every texture is generated procedurally.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # headless physics / flight-controller tests
npm run build      # static build in dist/ (relative paths, host anywhere)
```

Pushing to `main` deploys the build to GitHub Pages through `.github/workflows/pages.yml`. To turn it on,
go to **Settings → Pages → Source: GitHub Actions**.

## Controllers

1. Put your radio in **USB Joystick (HID)** mode (EdgeTX/OpenTX: plug in → *USB Joystick*). A gamepad also works.
2. Press any stick or button so the browser exposes the device.
3. Press **Esc** → **Controller** → **Run calibration wizard**. It detects each axis and its direction,
   records the stick ranges and centres, and learns your arm switch (an axis or a button).
4. Arming works like Betaflight: flip the arm switch with throttle low. If the switch is on with throttle
   up, the OSD shows `THROTTLE HIGH` until you lower it.

Without a controller you can fly on the keyboard:

- **Throttle:** `W`/`S`, and `X` cuts it.
- **Yaw:** `A`/`D`.
- **Pitch/roll:** arrow keys.
- **Arm:** `Space`.

Angle mode (`M`) makes keyboard flying much easier.

| Key | Action |
|-----|--------|
| `Esc` / `Tab` | Settings menu (pauses the sim) |
| `R` | Reset to launch pad |
| `C` | Camera: FPV → chase → line of sight |
| `M` | Acro ↔ Angle |
| `B` | Blackbox trace (setpoint vs gyro, for tuning) |
| `H` | Help |

## Flight model

The model is aimed at the feel of Liftoff and Velocidrone. Everything runs in a fixed 1 kHz loop
(`src/sim/`).

- **Flight controller** (`flightController.js`):
  - RC smoothing.
  - Betaflight *Actual* and *classic* rates, plus throttle mid/expo.
  - Gyro and D-term low-pass filters.
  - P/I/D/FF using Betaflight's internal scaling constants, so real tunes carry over.
  - I-term relax, TPA, PID-sum limits.
  - Airmode mixer with BF-style activation.
  - Angle mode.
- **Quad** (`quad.js`):
  - Rigid body with a full inertia tensor (including gyroscopic coupling).
  - Each motor follows a first-order spin-up/spin-down lag, and thrust scales with rpm².
  - Prop inflow loss, which limits top speed and adds aerodynamic damping because inflow is computed per rotor.
  - Yaw torque from prop drag and rotor acceleration.
  - Per-axis quadratic drag plus rotor H-force drag.
  - Prop-wash turbulence when you descend through your own wake.
  - Battery sag: voltage drops under load, which reduces rpm.
- **Collision** (`collision.js`): the quad is a sphere tested against about 1,400 oriented boxes, with a
  spatial-hash broadphase, restitution and friction. Crash-on-impact is optional.

Every parameter can be changed live in the settings UI. Changes save to `localStorage`, and you can
export or import them as JSON.

The defaults model a 650 g, 6S, 5" freestyle quad with a thrust-to-weight ratio of about 9:1. It hovers at
about 30% throttle and tops out near 130 km/h. With stock Betaflight 4.3 PIDs, roll and pitch step
responses overshoot by about 10%. `test/physics.test.js` checks all of these figures.

## Map: *Abandoned Works*

- A 5-floor concrete skeleton with collapsing slabs.
- A brick warehouse whose roof has partly fallen in, with racking and a gantry inside.
- A 9-floor tower with blown-out walls and a water tank on the roof.
- A ruined L-block with a collapsed corner you can use as a ramp.
- A container yard.
- A smokestack and boiler house, linked by a pipe bridge.
- Broken perimeter walls, rubble, power lines and graffiti.

Nine race gates make up a lap. The OSD tracks your current, last and best lap times, and the next gate
is highlighted in green.

## Layout

```
src/
  config.js              defaults + persistence
  main.js                renderer, cameras, game loop, arming, laps
  sim/                   rates, filters, flight controller, quad physics, collision
  world/                 procedural textures + map builder
  input/input.js         gamepad/RC mapping, calibration wizard, keyboard
  ui/                    settings menu, OSD, styles
test/                    node:test headless physics tests
PLAN.md                  milestones + progress log
```
