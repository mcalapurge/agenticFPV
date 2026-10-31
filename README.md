# agenticFPV

![FPV view at golden hour: lining up a race gate at the warehouse door, Betaflight-style OSD](docs/screenshots/hero-fpv-golden-hour.jpg)

A browser-based FPV drone simulator in the spirit of Velocidrone and Liftoff. It has:

- A Betaflight-style flight controller.
- Real USB RC-transmitter and gamepad support.
- Six quad classes.
- Race, practice and track-editor modes.
- Synthesised motor audio and simulated analog or digital video.
- An abandoned-industrial map.
- A title menu over a live autopilot demo that flies the map and throws flips, rolls and power loops.
- Phone and tablet support: on-screen sticks, auto-detected, with a switch on the title screen to override it.
- Installs to the home screen as a fullscreen app (no browser bars) and plays offline.

It's built on Three.js, and everything works with no downloaded assets.

## Screenshots

|                                                                             |                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![Title menu over a live autopilot flight](docs/screenshots/title-menu.jpg) | ![Demo mode: the autopilot mid power loop, with OSD and call-out](docs/screenshots/demo-power-loop.jpg) |
| **Title menu**: the autopilot keeps flying behind it                        | **Watch demo**: power loops, flips and rolls, flown with real stick inputs                              |

|                                                                                                                         |                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ![Inside the roofless warehouse on the Warehouse Sprint track, analog video](docs/screenshots/warehouse-run-analog.jpg) | ![Threading the floor-2 gate of the concrete skeleton, overcast](docs/screenshots/skeleton-floor-gate.jpg) |
| **Warehouse Sprint**: through the collapsed roof, analog link                                                           | **Works Circuit**: skeleton floor-2 gate, overcast                                                         |
| ![Hovering off the tower roof at dusk, eyeing the dive gate below](docs/screenshots/tower-dive-dusk.jpg)                | ![Night flying under the street lamps](docs/screenshots/night-street-lamps.jpg)                            |
| **Tower Dive**: dusk, dive gate below                                                                                   | **Night**: street lamps and stars                                                                          |
| ![Analog video breaking up behind buildings](docs/screenshots/analog-signal-breakup.jpg)                                | ![Race results card with holeshot, laps and leaderboard](docs/screenshots/race-results.jpg)                |
| **Analog breakup** at range and behind walls                                                                            | **Race mode**: results and local leaderboard                                                               |

![5" freestyle quad close-up: carbon frame, motor bells, twisted 3-blade props, strapped 6S LiPo](docs/screenshots/quad-closeup.jpg)

### On a phone

Touch controls switch on automatically on phones and tablets (see [Mobile & touch](#mobile--touch)).

|                                                                                                 |                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ![Title menu on a phone, with the touch-controls switch](docs/screenshots/mobile-title.jpg)     | ![Flying from a phone: two sticks, throttle bar, ARM and quick buttons](docs/screenshots/mobile-flight.jpg) |
| **Title menu**: the _Touch controls_ switch shows what was detected                             | **Flying**: left stick throttle + yaw, right stick pitch + roll, ARM and quick buttons                      |
| ![Controller settings on a phone, with the touch options](docs/screenshots/mobile-settings.jpg) | ![Portrait: a prompt to rotate to landscape](docs/screenshots/mobile-portrait.jpg)                          |
| **Settings** fit the screen, with touch options under _Controller_                              | **Portrait**: the game asks you to rotate                                                                   |

### Six quad classes, each with its own model and tune

![Quad classes: 5" freestyle, 5" race, 3" toothpick, 3" cinewhoop, 7" long range, 65mm tiny whoop](docs/screenshots/quad-classes.jpg)

### Settings

|                                                                                               |                                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![Race tab: modes, tracks, leaderboard](docs/screenshots/settings-race.jpg)                   | ![PIDs tab: Betaflight-scaled PIDs, simplified sliders, CLI import](docs/screenshots/settings-pids.jpg) |
| ![Rates tab: Actual / Betaflight rates with live curves](docs/screenshots/settings-rates.jpg) | ![Quad tab: pick a class](docs/screenshots/settings-quad.jpg)                                           |

<sub>Screenshots were captured with the in-repo build in headless Chromium.</sub>

## Quick start

Requires Node 22.18 or newer.

```bash
npm install
npm run dev            # http://localhost:5173
```

```bash
npm run build          # type-check + static build in dist/ (relative paths, host anywhere)
npm run preview        # serve the build
npm run fetch-assets   # optional: download CC0 Poly Haven photo textures (see below)
```

Pushing to `main` deploys the build to GitHub Pages through `.github/workflows/pages.yml`. To turn it on,
go to **Settings → Pages → Source: GitHub Actions**.

## Tech stack

| Layer     | Choice                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Language  | TypeScript (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`)                                            |
| 3D engine | Three.js, driven imperatively by a `Simulator` class (fixed-step 1 kHz physics, render loop, input, audio)   |
| UI        | React 19 for the settings menu and HUD. Per-frame HUD values are written through refs, not React re-renders. |
| State     | Zustand stores (Immer + persist) for config and UI state. The engine subscribes to the config slices it uses |
| Config    | One Zod schema gives the `Config` type, defaults, and forgiving validation of saved or imported settings     |
| Build     | Vite                                                                                                         |
| Quality   | ESLint (typescript-eslint, React Hooks / React Compiler rules), Prettier                                     |
| Tests     | Vitest (unit + jsdom component tests with Testing Library), Playwright (end-to-end + visual)                 |

## Testing

```bash
npm test               # all Vitest suites (unit + component), ~6 s
npm run test:unit      # physics, flight controller, presets, race logic, config schema, input, replay…
npm run test:component # React UI in jsdom: settings fields, tabs, CLI import, calibration wizard, overlays
npm run test:coverage  # Vitest with v8 coverage (HTML report in coverage/)
npm run test:e2e       # Playwright: boots the real build in Chromium and flies it (desktop + an emulated phone)
npm run test:mobile    # just the phone suite (Pixel 7, landscape, real multi-touch)
npm run test:visual    # Playwright screenshot comparisons of every settings tab
npm run test:all       # typecheck + lint + coverage + e2e (what CI runs)
```

- **Unit tests** (`test/unit/`) run the flight controller and quad physics headlessly at 1 kHz. The demo
  autopilot is tested the same way: it flies the real controller for minutes, never touches the ground
  after take-off, climbs over walls and skips tricks when there is no room. They check
  hover throttle, step response and overshoot on every axis for every quad class, top speed, flips, ground
  contact, turtle mode and wind. Pure game logic (race session, replay buffer, calibration wizard, config
  validation and migration, Betaflight CLI import, video-link model, texture tiling) is covered too.
- **Component tests** (`test/component/`) render the React UI against the real stores, with a fake
  simulator and gamepad where needed.
- **End-to-end tests** (`e2e/`) drive the production build in Chromium with software WebGL (SwiftShader), so
  they run the same on GPU-less CI machines. They arm and fly with the keyboard, crash into walls, change
  settings and check they reach the engine and survive a reload, run a full race (the quad is teleported
  through each gate, frame by frame, through the real loop), build and save a track in the editor, and use
  the replay. They also cover the title menu and demo, including a ten-minute demo soak on the real map
  (fast-forwarded with `sim.advance()`, no rendering) that must finish with no crashes, every trick performed
  and laps completed. The app exposes `window.__fpv` (simulator, config, UI store) for this.
- **Mobile tests** (`e2e/mobile.spec.ts`) run in an emulated Pixel 7 in landscape: auto-detection, the title
  switch, and flying with two thumbs at once. Multi-touch is injected straight into Chrome through the DevTools
  protocol (`e2e/fingers.ts`), so both sticks and a button can be held together. They also check that the title
  and every settings tab fit a phone screen in landscape and portrait.
- **PWA tests**: unit tests check the manifest, every icon's real pixel size, the iOS tags, and run the
  service worker in a fake worker scope (install, upgrade, offline fallback, caching rules). `e2e/pwa.spec.ts`
  checks Chrome's own installability report and that the worker caches the whole build, then **reloads with
  the network switched off** and plays. `e2e/safe-area.spec.ts` emulates the real insets of seven common phones
  (iPhone SE, 13 mini, 15, 14 Pro Max, Pixel 7, Galaxy S23, a compact Android) in both orientations and checks
  that every control, readout and panel stays inside the safe area and clear of the side-swipe edges.
- **Visual tests** (`e2e/visual.spec.ts`) compare screenshots of each settings tab. Baselines depend on
  the OS and fonts, so they're kept per platform. Run `npm run test:visual:update` to create them locally.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, Vitest with coverage, the build, and
the Playwright end-to-end suite on every push and pull request.

## Features

| Area                  | What you get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Flight model**      | 1 kHz rigid body. Each motor has spin-up/spin-down lag, and thrust scales with rpm². Also: prop inflow loss, yaw torque from prop drag and rotor acceleration, per-axis drag plus rotor H-force drag, prop-wash turbulence, battery sag, wind with gusts.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Collisions**        | The quad collides as 6 spheres (4 props, the body and the battery) with rigid-body impulses and friction, so it tumbles and comes to rest realistically. Crash-on-impact is optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Turtle mode**       | Betaflight crash-flip with reversible motors. It is latched at arming (switch or `T`), then you push the sticks toward the side you want to flip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Flight controller** | Betaflight scaling for P/I/D/FF. RC smoothing, gyro and D-term low-pass filters, I-term relax, TPA, airmode with an activation threshold, angle mode. Actual and classic Betaflight rates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Betaflight import** | Paste a CLI `diff all` (PIDs tab) to import PIDs, rates, TPA, filters, idle and airmode from your real quad.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Quad classes**      | 5" freestyle, 5" race, 3" toothpick, 3" cinewhoop, 7" long range and 65 mm tiny whoop. Each class has a tune checked by tests and its own detailed procedural model: twisted-airfoil props, motor bells, ducts, FC stack, a strapped LiPo.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Title menu & demo** | The app opens on a title menu (Fly, Watch demo, settings shortcuts) over a live autopilot flight. _Watch demo_ runs it full-screen with the OSD, trick call-outs and camera cuts; any key or stick movement returns. The pilot is a real stick-input autopilot: it flies a route round the map in angle mode, switches to acro for flips, rolls, power loops and a yaw spin, climbs over anything in its path and skips a trick if there is no room. It flies the quad class you picked on that class's stock tune, so your personal edits never break it and it never changes them.                                                                         |
| **Mobile & touch**    | Phones and tablets are detected automatically and get on-screen controls: throttle + yaw on the left stick (the throttle stays where you leave it, like a radio), roll + pitch on the right, both usable at once, plus ARM, throttle cut, turtle, reset, camera, flight-mode and menu buttons, optional vibration, and a rotate-to-landscape prompt. Detection is a best guess, so the title screen has a _Touch controls_ switch that always wins (with a one-tap return to auto-detect), and a Fullscreen button where the browser allows it. The settings and title menus are laid out for small screens. A connected gamepad or radio always takes over. |
| **Install & offline** | A web app manifest, icons and a service worker make it installable on iPhone and Android: it opens fullscreen with no browser bars and works with no signal after the first visit. The title screen shows how to install (Share → Add to Home Screen on iPhone, an Install button where the browser offers one) and hides it once installed. Every release gets a new worker that replaces the old cache. Layouts respect notches, the Dynamic Island, rounded corners, the home indicator and Android's side-swipe edges.                                                                                                                                   |
| **Game modes**        | Free fly, Practice (endless laps, a ghost of your personal best, split deltas), Race (countdown, holeshot, N laps, missed-gate warnings, results card, local leaderboard), Track editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Tracks**            | Works Circuit, Warehouse Sprint and Tower Dive (with tilted and dive gates), plus your own tracks. Tracks can be imported and exported as JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Replay**            | DVR of the last 90 s (`P`): seek, change speed, pause, switch camera.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Audio**             | WebAudio synthesis driven by simulated rpm: motor whine, blade-pass tones, prop noise, prop-wash flutter, wind rush, impacts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Video**             | Fisheye lens, chromatic aberration, vignette. The analog link gets static and breakup; the digital HD link gets blocking and freezes. Both depend on distance and on the number of walls between you and the quad. VTX power is selectable. The OSD shows RSSI or LQ.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Environment**       | Midday, golden hour, overcast, dusk and night (with street lamps). Lighting uses CC0 Poly Haven HDRIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Effects**           | GPU particle prop-wash dust that kicks up off the ground, slabs and roofs (grass clippings over grass), crash debris bursts, and instanced grass that sways in the wind and flattens and flutters under the prop wash.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Cameras**           | FPV (FOV and uptilt adjustable), chase, line of sight, orbit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Controllers

1. Put your radio in **USB Joystick (HID)** mode (EdgeTX/OpenTX: plug in → _USB Joystick_). A gamepad also works.
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

| Key               | Action                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `Esc` / `Tab`     | Settings (pauses)                                                   |
| `R`               | Reset / restart race                                                |
| `C`               | Camera: FPV → chase → LOS → orbit                                   |
| `M`               | Acro ↔ Angle                                                        |
| `T`               | Turtle mode (takes effect when you next arm)                        |
| `P`               | Replay (`←`/`→` seek, `↑`/`↓` speed, `Space` pause)                 |
| `G` / `Backspace` | Track editor: place a gate ahead of the quad / remove the last gate |
| `B`               | Blackbox trace (setpoint vs gyro)                                   |
| `H`               | Help                                                                |

## Mobile & touch

Open the game on a phone or tablet and the on-screen controls switch on by themselves.

- **Left stick:** drag up/down for throttle, left/right for yaw. Throttle is relative and **holds** where you
  leave it, like a real radio. **CUT** drops it to zero.
- **Right stick:** pitch (up = forward) and roll.
- **ARM:** tap it with the throttle at zero, then raise the throttle. **TURTLE** arms crash-flip for the next arm.
- **☰** opens the settings, **↺** resets, **CAM** changes camera, **ACRO / ANGL** switches flight mode.
- Use **landscape**. In portrait the game asks you to rotate. On the title screen, _Fullscreen_ hides the
  browser bars where supported (on iPhone, use _Share → Add to Home Screen_).

**Detection.** Phones and tablets are recognised by their user agent, iPadOS by its multi-touch, and
finger-only tablets by their primary pointer. A laptop with a touchscreen _and_ a mouse or trackpad is treated
as a desktop. If detection gets it wrong, flip the **Touch controls** switch on the title screen: it always
wins, and _use auto-detect_ puts detection back in charge. **Settings → Controller** also has _Auto-detect /
Always on / Off_, throttle hold, stick size, stick expo and vibration.

## Install as an app (no browser bars)

A browser tab always shows its own bars. Installing the game to your home screen removes them.

- **iPhone (Safari):** tap **Share** → **Add to Home Screen** → **Add**, then open **agenticFPV from your
  home screen**. It launches fullscreen. (It must be launched from the icon; the Safari tab keeps its bars.)
- **Android (Chrome):** use the **Install app** button on the title screen, or the browser menu **⋮ → Install
  app / Add to Home screen**. It launches fullscreen and locked to landscape.
- **Offline:** after the first visit the whole game is cached, so it also works with no signal. New versions
  download in the background and take over the next time you open it online.
- **iPhone notes:** iOS ignores the manifest's landscape lock, so rotate the phone yourself (the game shows a
  prompt in portrait).

**Safe areas.** The game draws under the notch and Dynamic Island, but keeps every control and readout inside
the safe area (`env(safe-area-inset-*)`), clear of the home indicator, and 28 px away from the left and right
edges where Android's back swipe starts. The insets are defined once as CSS variables in `src/ui/styles.css`.

Icons come from `public/icons/*.svg`. After changing one, run `npm run make-icons` to regenerate the PNGs.

## Textures & assets

Everything ships procedurally, so the repo contains no binary art:

- **Materials:** tileable fBm heightfields generate albedo, normal and roughness maps for concrete,
  brick, asphalt, rusted and painted corrugated metal, and wood (`src/engine/world/pbrRecipes.ts`).
- **HDRIs:** CC0 [Poly Haven](https://polyhaven.com) images bundled through
  [`@pmndrs/assets`](https://github.com/pmndrs/assets) (CC0).

**Photo textures (optional).** `npm run fetch-assets` downloads CC0 PBR texture sets from Poly Haven
into `public/textures/`. It also writes `manifest.json` and `CREDITS.md` there. Restart `npm run dev` (or
rebuild) and the game uses them automatically; without them it falls back to the procedural textures and
never asks for the files.

## Layout

```
src/
  main.tsx                  boots the Simulator, mounts React, exposes window.__fpv
  engine/
    Simulator.ts            renderer, cameras, fixed-step loop, arming, video-link sim, demo hand-over
    demo/                   autopilot (route following + tricks) and the demo route
    sim/                    rates, filters, flight controller, quad physics, collision, presets, BF CLI import
    game/                   tracks + records, race session (laps, splits, ghost), gates, replay, game modes
    world/                  map builder, procedural PBR, quad models, decal/alpha textures
    render/                 environment (sky, sun, IBL, time of day), video post-FX, prop-wash dust, grass wind
    audio/motorAudio.ts     WebAudio motor synth
    input/                  gamepad/RC mapping, calibration wizard, keyboard, touch sticks, phone/tablet detection
  state/                    Zod config schema, Zustand stores (config, UI, engine)
  ui/                       React: App, title menu + demo overlay, touch controls, HUD (OSD, sticks, blackbox, overlays), settings menu + tabs
scripts/fetch-assets.ts     optional CC0 texture download (runs directly on Node)
scripts/make-icons.ts       renders the app icon SVGs to the PNG sizes phones need
src/pwa/                    service worker template (stamped at build) and its build helpers
public/                     web app manifest and icons
test/unit/                  Vitest unit tests (node; jsdom where storage is involved)
test/component/             Vitest + Testing Library component tests (jsdom)
e2e/                        Playwright end-to-end and visual tests
PLAN.md                     milestones + progress log
```
