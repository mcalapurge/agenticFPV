// Settings menu: schema-driven fields bound directly to the config object.

import { DEFAULT_CONFIG, deepClone, deepMerge, getPath, setPath, saveConfig } from '../config.js';
import { applyRate } from '../sim/rates.js';
import { CHANNELS, INPUT_PRESETS, CalibrationWizard } from '../input/input.js';
import { QUAD_PRESETS, applyPreset } from '../sim/presets.js';
import { allTracks, getRecord, loadUserTracks, saveUserTracks } from '../game/tracks.js';
import { TIME_OF_DAY } from '../render/environment.js';
import { applyBetaflightCli } from '../sim/bfcli.js';
import { fmtTime } from './osd.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : String(c));
  return el;
};

const SCHEMA = {
  physics: [
    { title: 'Airframe', fields: [
      { path: 'physics.massG', label: 'All-up weight', unit: 'g', min: 150, max: 1500, step: 5 },
      { path: 'physics.motorThrustG', label: 'Max thrust / motor', unit: 'g', min: 300, max: 3000, step: 10 },
      { path: 'physics.armLengthMm', label: 'Motor distance', unit: 'mm', min: 30, max: 220, step: 1, help: 'centre → motor' },
      { path: 'physics.propInches', label: 'Prop diameter', unit: 'in', min: 1, max: 8, step: 0.1 },
      { path: 'physics.inertiaRoll', label: 'Inertia roll', unit: 'kg·m²', min: 0.0005, max: 0.01, step: 0.0001 },
      { path: 'physics.inertiaPitch', label: 'Inertia pitch', unit: 'kg·m²', min: 0.0005, max: 0.01, step: 0.0001 },
      { path: 'physics.inertiaYaw', label: 'Inertia yaw', unit: 'kg·m²', min: 0.0005, max: 0.02, step: 0.0001 },
    ] },
    { title: 'Motors & props', fields: [
      { path: 'physics.motorSpinUpMs', label: 'Spin-up time', unit: 'ms', min: 5, max: 100, step: 1 },
      { path: 'physics.motorSpinDownMs', label: 'Spin-down time', unit: 'ms', min: 5, max: 150, step: 1 },
      { path: 'physics.yawTorqueCoef', label: 'Yaw torque coef', min: 0.002, max: 0.05, step: 0.001, help: 'prop drag torque / thrust' },
      { path: 'physics.rotorInertia', label: 'Rotor inertia', min: 0, max: 0.00001, step: 0.0000001, help: 'yaw kick on motor accel' },
      { path: 'physics.propPitchSpeed', label: 'Prop pitch speed', unit: 'm/s', min: 20, max: 100, step: 1, help: 'limits top speed' },
      { path: 'physics.inflowGain', label: 'Inflow loss', min: 0, max: 1.5, step: 0.05 },
    ] },
    { title: 'Aerodynamics', fields: [
      { path: 'physics.dragFront', label: 'Drag front (Cd·A)', unit: 'm²', min: 0, max: 0.05, step: 0.001 },
      { path: 'physics.dragSide', label: 'Drag side (Cd·A)', unit: 'm²', min: 0, max: 0.05, step: 0.001 },
      { path: 'physics.dragTop', label: 'Drag top (Cd·A)', unit: 'm²', min: 0, max: 0.12, step: 0.001 },
      { path: 'physics.rotorDrag', label: 'Rotor (H-force) drag', min: 0, max: 0.5, step: 0.01 },
      { path: 'physics.angularDrag', label: 'Angular drag', min: 0, max: 0.003, step: 0.0001 },
      { path: 'physics.propwash', label: 'Prop-wash intensity', min: 0, max: 3, step: 0.05 },
      { path: 'physics.gravity', label: 'Gravity', unit: 'm/s²', min: 1, max: 20, step: 0.01 },
    ] },
    { title: 'Wind', fields: [
      { path: 'physics.windSpeed', label: 'Wind speed', unit: 'm/s', min: 0, max: 20, step: 0.5 },
      { path: 'physics.windDir', label: 'Wind from', unit: '°', min: 0, max: 359, step: 1, help: '0 = north (launch-pad heading)' },
      { path: 'physics.windGust', label: 'Gusts / turbulence', min: 0, max: 1, step: 0.05 },
    ] },
    { title: 'Battery', fields: [
      { path: 'physics.battery', label: 'Simulate battery sag', type: 'bool' },
      { path: 'physics.cells', label: 'Cells (S)', min: 1, max: 8, step: 1 },
      { path: 'physics.capacityMah', label: 'Capacity', unit: 'mAh', min: 300, max: 3000, step: 10 },
      { path: 'physics.internalResistance', label: 'IR per cell', unit: 'Ω', min: 0.001, max: 0.03, step: 0.001 },
      { path: 'physics.maxCurrentA', label: 'Max current', unit: 'A', min: 20, max: 300, step: 1 },
    ] },
    { title: 'Collisions', fields: [
      { path: 'physics.restitution', label: 'Bounciness', min: 0, max: 0.9, step: 0.05 },
      { path: 'physics.friction', label: 'Friction', min: 0, max: 1, step: 0.05 },
      { path: 'physics.crashEnabled', label: 'Crash on hard impact', type: 'bool' },
      { path: 'physics.crashSpeed', label: 'Crash impact speed', unit: 'm/s', min: 2, max: 40, step: 0.5 },
      { path: 'physics.turtlePower', label: 'Turtle mode power', min: 0.2, max: 1, step: 0.05 },
      { path: 'physics.reverseThrust', label: 'Reversed-prop efficiency', min: 0.1, max: 1, step: 0.05 },
    ] },
  ],
  filters: [
    { title: 'Filters', fields: [
      { path: 'filters.gyroLpfHz', label: 'Gyro lowpass', unit: 'Hz', min: 0, max: 500, step: 5, help: '0 = off' },
      { path: 'filters.dtermLpfHz', label: 'D-term lowpass', unit: 'Hz', min: 0, max: 300, step: 5, help: '0 = off' },
      { path: 'filters.rcSmoothingHz', label: 'RC smoothing', unit: 'Hz', min: 5, max: 150, step: 1 },
      { path: 'filters.gyroNoise', label: 'Motor noise on gyro', min: 0, max: 5, step: 0.1 },
    ] },
  ],
  camera: [
    { title: 'Camera', fields: [
      { path: 'camera.mode', label: 'View', type: 'select', options: { fpv: 'FPV', chase: 'Chase', los: 'Line of sight', orbit: 'Orbit' } },
      { path: 'camera.fov', label: 'FOV (horizontal)', unit: '°', min: 60, max: 160, step: 1 },
      { path: 'camera.tilt', label: 'Camera uptilt', unit: '°', min: -10, max: 70, step: 1 },
      { path: 'camera.showOsd', label: 'Show OSD', type: 'bool' },
      { path: 'camera.showSticks', label: 'Show stick overlay', type: 'bool' },
      { path: 'camera.showPerf', label: 'Show performance stats (F)', type: 'bool' },
    ] },
    { title: 'Video link', fields: [
      { path: 'video.system', label: 'Video system', type: 'select', options: { analog: 'Analog (static & breakup)', digital: 'Digital HD (blocky / freeze)', clean: 'Clean (no link sim)' } },
      { path: 'video.vtxPower', label: 'VTX power', type: 'select', num: true, options: { 25: '25 mW', 200: '200 mW', 600: '600 mW', 1000: '1 W' } },
      { path: 'video.fisheye', label: 'Lens distortion', min: 0, max: 1, step: 0.05 },
      { path: 'video.chroma', label: 'Chromatic aberration', min: 0, max: 2, step: 0.05 },
      { path: 'video.vignette', label: 'Vignette', min: 0, max: 1, step: 0.05 },
      { path: 'video.staticAmount', label: 'Static / breakup', min: 0, max: 2, step: 0.05 },
      { path: 'video.scanlines', label: 'Scanlines (analog)', min: 0, max: 1, step: 0.05 },
    ] },
    { title: 'Audio', fields: [
      { path: 'audio.enabled', label: 'Sound', type: 'bool' },
      { path: 'audio.volume', label: 'Master volume', min: 0, max: 1, step: 0.05 },
      { path: 'audio.motorVolume', label: 'Motors & props', min: 0, max: 2, step: 0.05 },
      { path: 'audio.windVolume', label: 'Wind rush', min: 0, max: 2, step: 0.05 },
    ] },
    { title: 'Environment', fields: [
      { path: 'graphics.timeOfDay', label: 'Time of day', type: 'select', options: Object.fromEntries(Object.entries(TIME_OF_DAY).map(([k, v]) => [k, v.label])) },
      { path: 'physics.windSpeed', label: 'Wind speed', unit: 'm/s', min: 0, max: 20, step: 0.5 },
      { path: 'physics.windGust', label: 'Gusts', min: 0, max: 1, step: 0.05 },
    ] },
    { title: 'Graphics', fields: [
      { path: 'graphics.ibl', label: 'HDRI lighting (IBL)', type: 'bool' },
      { path: 'graphics.effects', label: 'Prop-wash dust & grass', type: 'bool' },
      { path: 'graphics.shadows', label: 'Shadows', type: 'bool' },
      { path: 'graphics.fog', label: 'Fog / haze', type: 'bool' },
      { path: 'graphics.pixelRatio', label: 'Render scale', min: 0.5, max: 2, step: 0.25 },
    ] },
  ],
};

export class SettingsMenu {
  constructor(root, config, { input, game, onChange, onClose }) {
    this.game = game;
    this.root = root;
    this.config = config;
    this.input = input;
    this.onChange = onChange;
    this.onClose = onClose;
    this.tab = 'controller';
    this.wizard = null;
    this.live = []; // per-frame updaters for the active tab
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open(tab) {
    if (tab) this.tab = tab;
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    this.wizard = null;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  _changed(path) {
    saveConfig(this.config);
    this.onChange?.(path);
  }

  render() {
    this.live = [];
    const tabs = [
      ['race', 'Race'], ['quad', 'Quad'], ['controller', 'Controller'], ['rates', 'Rates'], ['pids', 'PIDs'], ['filters', 'Filters'],
      ['physics', 'Physics'], ['camera', 'Video, Env & Audio'], ['help', 'Help'],
    ];
    const body = h('div', { class: 'body' });
    const panel = h('div', { class: 'panel' },
      h('header', {},
        h('h1', {}, 'agentic', h('span', {}, 'FPV')),
        h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', {
          class: id === this.tab ? 'active' : '',
          onclick: () => { this.tab = id; this.wizard = null; this.render(); },
        }, label))),
      ),
      body,
      h('footer', {},
        h('button', { class: 'btn', onclick: () => this._resetTab() }, 'Reset tab to defaults'),
        h('button', { class: 'btn', onclick: () => this._export() }, 'Export JSON'),
        h('button', { class: 'btn', onclick: () => this._import() }, 'Import JSON'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'hint' }, 'Changes apply live and are saved automatically · '),
        h('button', { class: 'btn primary', onclick: () => this.close() }, 'Fly ▶'),
      ),
    );
    this.root.replaceChildren(panel);
    const fn = {
      controller: () => this._controllerTab(body),
      rates: () => this._ratesTab(body),
      pids: () => this._pidTab(body),
      quad: () => this._quadTab(body),
      race: () => this._raceTab(body),
      help: () => this._helpTab(body),
    }[this.tab];
    if (fn) fn();
    else this._schemaTab(body, SCHEMA[this.tab]);
    if (this.tab === 'physics') this._physicsDerived(body);
    if (this.tab === 'camera' && this.gpu) {
      body.prepend(h('div', { class: 'section' }, h('div', { class: this.gpu.software ? 'warnline' : 'derived' },
        `GPU: ${this.gpu.label} · ${this.gpu.webgl2 ? 'WebGL 2' : 'WebGL 1'}${this.gpu.software ? ' · SOFTWARE RENDERING — enable hardware acceleration in your browser' : ' · hardware accelerated'}`)));
    }
  }

  update() {
    if (!this.isOpen) return;
    this.wizard?.update();
    for (const f of this.live) f();
  }

  // ── generic fields ────────────────────────────────────────────────────────
  _field(f) {
    const v = getPath(this.config, f.path);
    const label = h('label', {}, f.label, f.unit ? ` (${f.unit})` : '', f.help ? h('small', {}, f.help) : null);
    if (f.type === 'bool') {
      const cb = h('input', { type: 'checkbox', onchange: (e) => { setPath(this.config, f.path, e.target.checked); this._changed(f.path); } });
      cb.checked = !!v;
      return h('div', { class: 'row' }, label, cb, h('span'));
    }
    if (f.type === 'select') {
      const sel = h('select', { onchange: (e) => { setPath(this.config, f.path, f.num ? +e.target.value : e.target.value); this._changed(f.path); this.render(); } },
        Object.entries(f.options).map(([k, l]) => { const o = h('option', { value: k }, l); if (String(k) === String(v)) o.selected = true; return o; }));
      sel.style.gridColumn = '2 / 4';
      return h('div', { class: 'row' }, label, sel);
    }
    const range = h('input', { type: 'range', min: f.min, max: f.max, step: f.step });
    const num = h('input', { type: 'number', min: f.min, max: f.max, step: f.step });
    range.value = num.value = v;
    const set = (val) => {
      const n = parseFloat(val);
      if (Number.isNaN(n)) return;
      setPath(this.config, f.path, n);
      range.value = num.value = n;
      this._changed(f.path);
      f.after?.();
    };
    range.addEventListener('input', (e) => set(e.target.value));
    num.addEventListener('change', (e) => set(e.target.value));
    return h('div', { class: 'row' }, label, range, num);
  }

  _schemaTab(body, sections) {
    for (const s of sections) {
      body.append(h('div', { class: 'section' }, h('h3', {}, s.title), h('div', { class: 'grid2' }, s.fields.map((f) => this._field(f)))));
    }
  }

  _physicsDerived(body) {
    const out = h('div', { class: 'derived' });
    const upd = () => {
      const p = this.config.physics;
      const tw = (p.motorThrustG * 4) / p.massG;
      out.textContent = `Thrust-to-weight: ${tw.toFixed(1)} : 1   ·   Approx. hover throttle: ${(Math.sqrt(1 / tw) * 100).toFixed(0)}%`;
    };
    upd();
    this.live.push(upd);
    body.prepend(h('div', { class: 'section' }, out));
  }

  // ── Race tab ─────────────────────────────────────────────────────────────
  _raceTab(body) {
    const g = this.config.game;
    const game = this.game;
    const modes = [['free', 'Free fly', 'No gates, no timer — freestyle'], ['practice', 'Practice', 'Endless laps, PB ghost, split deltas'], ['race', 'Race', 'Countdown, N laps, results & leaderboard'], ['editor', 'Track editor', 'Fly around and drop gates with G']];
    const modeCards = h('div', { class: 'cards' }, modes.map(([id, name, desc]) => h('button', {
      class: `card${g.mode === id ? ' active' : ''}`,
      onclick: () => { game.setMode(id); this._changed('game.mode'); this.render(); },
    }, h('b', {}, name), h('span', {}, desc))));

    const quadId = this.config.quad.preset;
    const list = h('div', { class: 'tracklist' });
    for (const t of allTracks()) {
      const rec = getRecord(t.id, quadId);
      const actions = h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { game.loadTrack(t.id); if (g.mode === 'free' || g.mode === 'editor') game.setMode(g.mode === 'editor' ? 'editor' : 'practice'); this._changed('game.track'); this.render(); } }, t.id === game.track.id ? 'Selected' : 'Select'),
        h('button', { class: 'btn', onclick: () => this._download(`${t.id}.track.json`, { name: t.name, description: t.description, gates: t.gates }) }, 'Export'),
        t.user ? h('button', { class: 'btn', onclick: () => { saveUserTracks(loadUserTracks().filter((x) => x.id !== t.id)); if (game.track.id === t.id) game.loadTrack('works'); this._changed('game.track'); this.render(); } }, 'Delete') : null);
      list.append(h('div', { class: `trackrow${t.id === game.track.id ? ' active' : ''}` },
        h('div', {}, h('b', {}, t.name, t.user ? ' (custom)' : ''), h('small', {}, `${t.gates.length} gates · ${t.description || ''}`), h('small', {}, rec?.bestLap != null ? `PB with this quad: ${fmtTime(rec.bestLap)}` : 'No lap set with this quad yet')),
        actions));
    }

    const editor = h('div', { class: 'section' });
    if (g.mode === 'editor') {
      const name = h('input', { type: 'text', value: game.track.name });
      editor.append(h('h3', {}, 'Track editor'),
        h('p', { class: 'hint' }, 'Fly to where you want a gate, point the quad through it and press G (dive gates: point the nose straight down). Backspace removes the last gate. Gate 1 is start/finish.'),
        h('div', { class: 'row' }, h('label', {}, 'Track name'), name, h('span')),
        h('button', { class: 'btn primary', onclick: () => { game.saveTrack(name.value.trim() || 'My track'); this.render(); } }, 'Save track'), ' ',
        h('button', { class: 'btn', onclick: () => { game.track.gates = []; game.rebuildGates(); this.render(); } }, 'Clear gates'), ' ',
        h('span', { class: 'hint' }, `${game.track.gates.length} gates`));
    }

    const rec = getRecord(game.track.id, quadId);
    const board = h('table', { class: 'pid' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Laps'), h('th', {}, 'Total'), h('th', {}, 'Best lap'), h('th', {}, 'Date')),
      (rec?.races || []).map((r, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, r.laps), h('td', {}, fmtTime(r.total)), h('td', {}, fmtTime(r.best)), h('td', {}, new Date(r.date).toLocaleString()))));

    body.append(
      h('div', { class: 'section' }, h('h3', {}, 'Mode'), modeCards),
      h('div', { class: 'section' }, h('h3', {}, 'Options'), h('div', { class: 'grid2' },
        this._field({ path: 'game.laps', label: 'Race laps', min: 1, max: 10, step: 1 }),
        this._field({ path: 'game.ghost', label: 'Show PB ghost', type: 'bool' }),
        this._field({ path: 'game.gatesInFree', label: 'Gates in free fly', type: 'bool' }))),
      editor,
      h('div', { class: 'section' }, h('h3', {}, 'Tracks'), list,
        h('p', {}, h('button', { class: 'btn', onclick: () => this._importTrack() }, 'Import track JSON'))),
      h('div', { class: 'section' }, h('h3', {}, `Leaderboard · ${game.track.name} · ${QUAD_PRESETS[quadId]?.name ?? ''}`),
        rec?.races?.length ? board : h('p', { class: 'hint' }, 'No races yet. Switch to Race mode and set a time!')),
    );
  }

  _download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  _importTrack() {
    const inp = h('input', { type: 'file', accept: 'application/json' });
    inp.addEventListener('change', async () => {
      try {
        const t = JSON.parse(await inp.files[0].text());
        if (!Array.isArray(t.gates)) throw new Error('no gates array');
        const id = `user-${Date.now().toString(36)}`;
        saveUserTracks([...loadUserTracks(), { id, name: t.name || 'Imported track', description: t.description || '', gates: t.gates }]);
        this.game.loadTrack(id);
        this._changed('game.track');
        this.render();
        this.onToast?.('Track imported ✔');
      } catch (err) {
        this.onToast?.(`Import failed: ${err.message}`);
      }
    });
    inp.click();
  }

  // ── Quad tab ─────────────────────────────────────────────────────────────
  _quadTab(body) {
    const cur = this.config.quad.preset;
    const grid = h('div', { class: 'cards' });
    for (const [id, p] of Object.entries(QUAD_PRESETS)) {
      const ph = p.physics;
      const tw = ((ph.motorThrustG * 4) / ph.massG).toFixed(1);
      grid.append(h('button', {
        class: `card${id === cur ? ' active' : ''}`,
        onclick: () => {
          applyPreset(this.config, id);
          this._changed('quad.preset');
          this.render();
          this.onToast?.(`${p.name} selected`);
        },
      },
      h('b', {}, p.name),
      h('span', {}, `${ph.massG} g · ${ph.propInches}" ${p.model.blades}-blade · ${ph.cells}S`),
      h('span', {}, `T:W ${tw}:1 · ${ph.armLengthMm * 2} mm wheelbase`)));
    }
    body.append(
      h('div', { class: 'section' }, h('h3', {}, 'Quad class'), grid,
        h('p', { class: 'hint' }, 'Selecting a class loads its airframe physics and a matching PID tune (your rates are kept). Fine-tune anything afterwards in the Physics / PIDs tabs.')),
    );
  }

  // ── Controller tab ───────────────────────────────────────────────────────
  _controllerTab(body) {
    const cfg = this.config.input;
    const pads = this.input.listGamepads();
    const padSel = h('select', { onchange: (e) => { cfg.gamepadIndex = +e.target.value; this._changed('input'); } },
      pads.length ? pads.map((p) => { const o = h('option', { value: p.index }, `#${p.index} ${p.id}`); if (p.index === cfg.gamepadIndex) o.selected = true; return o; })
        : [h('option', {}, 'No controller detected — move a stick or press a button')]);
    const presetSel = h('select', {}, h('option', { value: '' }, 'Apply a preset…'), Object.keys(INPUT_PRESETS).map((k) => h('option', { value: k }, k)));
    presetSel.addEventListener('change', (e) => {
      const p = INPUT_PRESETS[e.target.value];
      if (!p) return;
      Object.assign(cfg, deepClone(p));
      this._changed('input');
      this.render();
    });

    // Wizard
    const wiz = h('div', { class: 'wizard', style: 'display:none' });
    const startWizard = () => {
      wiz.style.display = 'block';
      this.wizard = new CalibrationWizard(this.input, (step, i, n) => {
        wiz.replaceChildren(
          h('p', {}, h('b', {}, `Step ${Math.min(i + 1, n)}/${n}: `), step.text),
          h('button', { class: 'btn primary', onclick: () => this.wizard.next() }, i + 1 >= n ? 'Finish' : 'Next'),
          ' ',
          step.arm ? h('button', { class: 'btn', onclick: () => this.wizard.next(true) }, 'Skip') : null,
          ' ',
          h('button', { class: 'btn', onclick: () => { this.wizard = null; wiz.style.display = 'none'; } }, 'Cancel'),
        );
      }, () => {
        this.wizard = null;
        this._changed('input');
        this.render();
        this.onToast?.('Calibration saved ✔');
      });
      this.wizard.start();
    };

    // Live raw axes
    const rawBars = h('div', { class: 'bars' });
    const chanBars = h('div', { class: 'bars' });
    const mkBar = (name) => {
      const fill = h('div', { class: 'fill' });
      const val = h('span');
      return { el: h('div', { class: 'bar' }, h('span', {}, name), h('div', { class: 'track' }, h('div', { class: 'mid' }), fill), val), fill, val };
    };
    const chanEls = Object.fromEntries([...CHANNELS, 'arm'].map((c) => { const b = mkBar(c.toUpperCase()); chanBars.append(b.el); return [c, b]; }));
    let rawEls = [];
    this.live.push(() => {
      const pad = this.input.getGamepad();
      const axes = pad ? pad.axes : [];
      if (rawEls.length !== axes.length) {
        rawBars.replaceChildren();
        rawEls = axes.map((_, i) => { const b = mkBar(`Axis ${i}`); rawBars.append(b.el); return b; });
        if (!axes.length) rawBars.append(h('span', { class: 'hint' }, 'No gamepad axes. Keyboard fallback active.'));
      }
      axes.forEach((v, i) => {
        const b = rawEls[i];
        const x = (v + 1) / 2;
        b.fill.style.left = `${Math.min(x, 0.5) * 100}%`;
        b.fill.style.width = `${Math.abs(x - 0.5) * 100}%`;
        b.val.textContent = v.toFixed(2);
      });
      const st = this.input.state;
      for (const c of CHANNELS) {
        const b = chanEls[c];
        const v = st[c];
        if (c === 'throttle') { b.fill.style.left = '0%'; b.fill.style.width = `${v * 100}%`; }
        else { const x = (v + 1) / 2; b.fill.style.left = `${Math.min(x, 0.5) * 100}%`; b.fill.style.width = `${Math.abs(x - 0.5) * 100}%`; }
        b.val.textContent = c === 'throttle' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2);
      }
      chanEls.arm.fill.style.left = '0%';
      chanEls.arm.fill.style.width = st.armSwitch ? '100%' : '0%';
      chanEls.arm.fill.style.background = st.armSwitch ? 'var(--bad)' : 'var(--accent2)';
      chanEls.arm.val.textContent = st.armSwitch ? 'ON' : 'off';
    });

    // Mapping table
    const axisOpts = (sel) => Array.from({ length: 8 }, (_, i) => { const o = h('option', { value: i }, `Axis ${i}`); if (i === sel) o.selected = true; return o; });
    const mapping = h('table', { class: 'pid' },
      h('tr', {}, h('th', {}, 'Channel'), h('th', {}, 'Axis'), h('th', {}, 'Invert'), h('th', {}, 'Min'), h('th', {}, 'Center'), h('th', {}, 'Max')),
      CHANNELS.map((ch) => {
        const c = cfg.channels[ch];
        const num = (k) => { const i = h('input', { type: 'number', step: 0.01, onchange: (e) => { c[k] = parseFloat(e.target.value); this._changed('input'); } }); i.value = (+c[k]).toFixed(3); return i; };
        const inv = h('input', { type: 'checkbox', onchange: (e) => { c.invert = e.target.checked; this._changed('input'); } });
        inv.checked = c.invert;
        return h('tr', {}, h('td', {}, ch), h('td', {}, h('select', { onchange: (e) => { c.axis = +e.target.value; this._changed('input'); } }, axisOpts(c.axis))), h('td', {}, inv), h('td', {}, num('min')), h('td', {}, num('center')), h('td', {}, num('max')));
      }),
    );

    const swEditor = (key, title) => {
      const sw = cfg[key];
      const typeSel = h('select', { onchange: (e) => { sw.type = e.target.value; this._changed('input'); this.render(); } },
        ['none', 'axis', 'button'].map((t) => { const o = h('option', { value: t }, t); if (t === sw.type) o.selected = true; return o; }));
      const idx = h('input', { type: 'number', step: 1, min: 0, max: 31, onchange: (e) => { sw.index = +e.target.value; this._changed('input'); } });
      idx.value = sw.index;
      const thr = h('input', { type: 'number', step: 0.05, onchange: (e) => { sw.threshold = +e.target.value; this._changed('input'); } });
      thr.value = sw.threshold ?? 0.5;
      const inv = h('input', { type: 'checkbox', onchange: (e) => { sw.invert = e.target.checked; this._changed('input'); } });
      inv.checked = !!sw.invert;
      const tog = h('input', { type: 'checkbox', onchange: (e) => { sw.toggle = e.target.checked; this._changed('input'); } });
      tog.checked = !!sw.toggle;
      return h('table', { class: 'pid' },
        h('tr', {}, h('th', {}, title), h('th', {}, 'Source'), h('th', {}, 'Index'), h('th', {}, 'Threshold'), h('th', {}, 'Invert'), h('th', {}, 'Btn toggles')),
        h('tr', {}, h('td', {}, ''), h('td', {}, typeSel), h('td', {}, idx), h('td', {}, thr), h('td', {}, inv), h('td', {}, tog)));
    };

    body.append(
      h('div', { class: 'section' }, h('h3', {}, 'Device'),
        h('div', { class: 'grid2' },
          h('div', { class: 'row' }, h('label', {}, 'Controller'), padSel, h('span')),
          h('div', { class: 'row' }, h('label', {}, 'Preset'), presetSel, h('span'))),
        h('p', { class: 'hint' }, 'Radio transmitters: enable USB Joystick (HID) mode, plug in, then press any stick/button so the browser exposes it. Run the wizard to map and calibrate.'),
        h('button', { class: 'btn primary', onclick: startWizard }, 'Run calibration wizard'),
        wiz),
      h('div', { class: 'grid2' },
        h('div', { class: 'section' }, h('h3', {}, 'Mapped channels'), chanBars),
        h('div', { class: 'section' }, h('h3', {}, 'Raw axes'), rawBars)),
      h('div', { class: 'section' }, h('h3', {}, 'Channel mapping & calibration'), mapping,
        this._field({ path: 'input.deadband', label: 'Deadband', min: 0, max: 0.2, step: 0.005 })),
      h('div', { class: 'section' }, h('h3', {}, 'Switches'), swEditor('arm', 'Arm'), h('br'), swEditor('mode', 'Angle mode'), h('br'), swEditor('turtle', 'Turtle'),
        h('p', { class: 'hint' }, 'Arming requires throttle low (BF-style). With no switch mapped, Space/Enter toggles arm. Turtle mode (crash flip) is latched when you arm with the turtle switch on (keyboard: T), then push the sticks toward the side you want to flip.')),
    );
  }

  // ── Rates tab ────────────────────────────────────────────────────────────
  _ratesTab(body) {
    const r = this.config.rates;
    const isActual = r.type === 'actual';
    const cols = isActual ? ['Center sens.', 'Max rate', 'Expo'] : ['RC rate', 'Super rate', 'RC expo'];
    const canvas = h('canvas', { class: 'graph', width: 520, height: 300 });
    const maxCells = {};
    const draw = () => {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = '#2c313a';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo((W * i) / 4, 0); ctx.lineTo((W * i) / 4, H); ctx.stroke();
      }
      const colors = { roll: '#ff7a1a', pitch: '#22c8ff', yaw: '#46d37b' };
      let maxAll = 200;
      for (const ax of ['roll', 'pitch', 'yaw']) maxAll = Math.max(maxAll, Math.abs(applyRate(r.type, 1, r[ax])));
      maxAll = Math.ceil(maxAll / 200) * 200;
      for (const ax of ['roll', 'pitch', 'yaw']) {
        ctx.strokeStyle = colors[ax];
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const s = i / 100;
          const v = applyRate(r.type, s, r[ax]);
          const x = s * W, y = H - (v / maxAll) * H;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        maxCells[ax] && (maxCells[ax].textContent = `${applyRate(r.type, 1, r[ax]).toFixed(0)}°/s`);
      }
      ctx.fillStyle = '#8b929c';
      ctx.font = '12px sans-serif';
      ctx.fillText(`${maxAll}°/s`, 6, 14);
      ctx.fillText('stick →', W - 50, H - 6);
      // live stick markers
      const st = this.input.state;
      for (const ax of ['roll', 'pitch', 'yaw']) {
        const s = Math.abs(st[ax]);
        const v = applyRate(r.type, s, r[ax]);
        ctx.fillStyle = colors[ax];
        ctx.beginPath(); ctx.arc(s * W, H - (v / maxAll) * H, 5, 0, Math.PI * 2); ctx.fill();
      }
    };
    const typeSel = h('select', { onchange: (e) => {
      r.type = e.target.value;
      // convert to sensible defaults for the new type
      const d = e.target.value === 'actual' ? { rcRate: 70, rate: 670, expo: 0.54 } : { rcRate: 100, rate: 70, expo: 0 };
      for (const ax of ['roll', 'pitch', 'yaw']) r[ax] = { ...d };
      this._changed('rates'); this.render();
    } }, [['actual', 'Actual (BF 4.3+ default)'], ['betaflight', 'Betaflight (classic)']].map(([k, l]) => { const o = h('option', { value: k }, l); if (k === r.type) o.selected = true; return o; }));
    const table = h('table', { class: 'pid' },
      h('tr', {}, h('th', {}, ''), cols.map((c) => h('th', {}, c)), h('th', {}, 'Max °/s')),
      ['roll', 'pitch', 'yaw'].map((ax) => {
        const cell = (k, step) => { const i = h('input', { type: 'number', step, onchange: (e) => { r[ax][k] = parseFloat(e.target.value); this._changed('rates'); draw(); } }); i.value = r[ax][k]; return h('td', {}, i); };
        maxCells[ax] = h('td', { class: 'derived' });
        return h('tr', {}, h('td', {}, ax.toUpperCase()), cell('rcRate', 1), cell('rate', isActual ? 10 : 1), cell('expo', 0.01), maxCells[ax]);
      }));
    body.append(
      h('div', { class: 'section' }, h('h3', {}, 'Rates'), h('div', { class: 'row' }, h('label', {}, 'Rates type'), typeSel, h('span')), table),
      h('div', { class: 'section' }, h('h3', {}, 'Rate curves'), canvas),
      h('div', { class: 'section' }, h('h3', {}, 'Throttle'), h('div', { class: 'grid2' },
        this._field({ path: 'rates.throttleMid', label: 'Throttle mid', min: 0, max: 1, step: 0.01 }),
        this._field({ path: 'rates.throttleExpo', label: 'Throttle expo', min: 0, max: 1, step: 0.01 }),
        this._field({ path: 'rates.throttleLimit', label: 'Throttle limit', min: 0.2, max: 1, step: 0.01 }),
        this._field({ path: 'flight.motorIdle', label: 'Motor idle', min: 0, max: 0.15, step: 0.005 }))),
    );
    draw();
    this.live.push(draw);
  }

  // ── PID tab ──────────────────────────────────────────────────────────────
  _pidTab(body) {
    const pid = this.config.pid;
    const table = h('table', { class: 'pid' },
      h('tr', {}, h('th', {}, ''), ['P', 'I', 'D', 'FF'].map((t) => h('th', {}, t))),
      ['roll', 'pitch', 'yaw'].map((ax) => h('tr', {}, h('td', {}, ax.toUpperCase()),
        ['p', 'i', 'd', 'f'].map((k) => {
          const i = h('input', { type: 'number', min: 0, max: 250, step: 1, onchange: (e) => { pid[ax][k] = parseFloat(e.target.value) || 0; this._changed('pid'); } });
          i.value = pid[ax][k];
          return h('td', {}, i);
        }))));
    // Master multiplier sliders (like the BF simplified tuning sliders)
    const master = h('div', { class: 'grid2' });
    const base = deepClone(pid);
    const slider = (label, keys) => {
      const range = h('input', { type: 'range', min: 0.5, max: 1.6, step: 0.05, value: 1 });
      const val = h('span', {}, '1.00×');
      range.addEventListener('input', (e) => {
        const m = parseFloat(e.target.value);
        val.textContent = `${m.toFixed(2)}×`;
        for (const ax of ['roll', 'pitch', 'yaw']) for (const k of keys) pid[ax][k] = Math.round(base[ax][k] * m);
        this._changed('pid');
        table.querySelectorAll('input').forEach((inp, idx) => { const ax = ['roll', 'pitch', 'yaw'][Math.floor(idx / 4)]; inp.value = pid[ax][['p', 'i', 'd', 'f'][idx % 4]]; });
      });
      return h('div', { class: 'row' }, h('label', {}, label), range, val);
    };
    master.append(slider('Master multiplier', ['p', 'i', 'd', 'f']), slider('P & D gain', ['p', 'd']), slider('Feedforward', ['f']), slider('I gain', ['i']));

    const cliBox = h('div', { class: 'wizard', style: 'display:none' });
    const cliText = h('textarea', { rows: 8, placeholder: 'Paste the output of `diff all` (or `dump`) from the Betaflight CLI…', style: 'width:100%;background:#0b0c0f;color:var(--text);border:1px solid #343a45;border-radius:6px;font:12px ui-monospace,monospace;padding:8px' });
    const cliOut = h('pre', { class: 'hint', style: 'white-space:pre-wrap;max-height:160px;overflow:auto' });
    cliBox.append(
      h('p', {}, 'Paste a Betaflight CLI diff to import PIDs, feedforward, TPA, filters, idle, airmode and rates (active profile and rate profile are used).'),
      cliText,
      h('p', {},
        h('button', { class: 'btn primary', onclick: () => {
          const changes = applyBetaflightCli(this.config, cliText.value);
          if (!changes.length) { cliOut.textContent = 'Nothing recognised — make sure you pasted `set …` lines.'; return; }
          this._changed('all');
          this.render();
          this.onToast?.(`Imported ${changes.length - 1} settings from Betaflight`);
        } }, 'Import'), ' ',
        h('button', { class: 'btn', onclick: () => { cliBox.style.display = 'none'; } }, 'Cancel')),
      cliOut,
    );
    body.append(
      h('div', { class: 'section' }, h('button', { class: 'btn', onclick: () => { cliBox.style.display = 'block'; cliText.focus(); } }, 'Import from Betaflight CLI…'), cliBox),
      h('div', { class: 'section' }, h('h3', {}, 'PID profile (Betaflight scaling)'), table,
        h('p', { class: 'hint' }, 'Numbers use Betaflight’s internal scaling, so a real tune is a good starting point. Press B in flight to show the setpoint-vs-gyro trace.')),
      h('div', { class: 'section' }, h('h3', {}, 'Simplified tuning'), master),
    );
    this._schemaTab(body, [
      { title: 'Flight mode', fields: [
        { path: 'flight.mode', label: 'Mode', type: 'select', options: { acro: 'Acro (rate)', angle: 'Angle (self-level)' } },
        { path: 'pid.angleStrength', label: 'Angle strength', min: 10, max: 200, step: 1 },
        { path: 'pid.angleLimit', label: 'Angle limit', unit: '°', min: 10, max: 85, step: 1 },
      ] },
      { title: 'PID controller settings', fields: [
        { path: 'pid.airmode', label: 'Airmode', type: 'bool' },
        { path: 'pid.itermRelax', label: 'I-term relax', type: 'bool' },
        { path: 'pid.itermRelaxCutoff', label: 'I-term relax threshold', unit: '°/s', min: 5, max: 200, step: 1 },
        { path: 'pid.iTermLimit', label: 'I-term limit', min: 50, max: 500, step: 5 },
        { path: 'pid.pidSumLimit', label: 'PID sum limit', min: 100, max: 1000, step: 10 },
        { path: 'pid.pidSumLimitYaw', label: 'PID sum limit yaw', min: 100, max: 1000, step: 10 },
        { path: 'pid.tpaRate', label: 'TPA rate', min: 0, max: 1, step: 0.01 },
        { path: 'pid.tpaBreakpoint', label: 'TPA breakpoint', min: 0, max: 1, step: 0.01 },
      ] },
    ]);
  }

  _helpTab(body) {
    const k = (s) => h('kbd', {}, s);
    body.append(
      h('div', { class: 'section' }, h('h3', {}, 'Getting started'),
        h('p', {}, '1. Plug in your radio in USB Joystick mode (or a gamepad) and run the calibration wizard in the Controller tab.'),
        h('p', {}, '2. Map your arm switch. Arming requires throttle at zero, like Betaflight.'),
        h('p', {}, '3. Fly! Acro mode is the default. Switch to Angle mode in the PIDs tab, or map a switch, if you are learning.'),
        h('p', {}, 'Race tab: Free fly, Practice (endless laps + ghost of your PB), Race (countdown, laps, results, leaderboard) or the Track editor. The next gate glows green, the one after yellow; the OSD arrow points to it when off-screen.'),
        h('p', {}, 'Quad tab: pick a class (5" freestyle/race, 3" toothpick, cinewhoop, 7" long range, tiny whoop). PIDs tab: tune, or paste a Betaflight CLI diff.'),
        h('p', {}, 'Crashed upside-down? Disarm, turn on turtle mode (switch or T), arm, and push the stick toward the side to flip over. Then disarm, turtle off, re-arm.')),
      h('div', { class: 'section' }, h('h3', {}, 'Keys'),
        h('p', {}, k('F'), ' performance stats · ', k('Esc'), ' / ', k('Tab'), ' menu · ', k('R'), ' reset / restart race · ', k('C'), ' camera (FPV, chase, LOS, orbit) · ', k('M'), ' acro/angle · ', k('T'), ' turtle mode · ', k('B'), ' blackbox trace · ', k('H'), ' help'),
        h('p', {}, k('P'), ' replay (last 90 s): ', k('←'), k('→'), ' seek · ', k('↑'), k('↓'), ' speed · ', k('Space'), ' pause · ', k('C'), ' camera'),
        h('p', {}, 'Track editor: ', k('G'), ' place gate ahead of the quad · ', k('Backspace'), ' remove last gate · save from the Race tab'),
        h('p', {}, 'Keyboard flying: ', k('W'), k('S'), ' throttle · ', k('X'), ' cut throttle · ', k('A'), k('D'), ' yaw · arrows pitch/roll · ', k('Space'), ' arm/disarm')),
    );
  }

  _resetTab() {
    const map = { race: ['game'], quad: [], controller: ['input'], rates: ['rates', 'flight.motorIdle'], pids: ['pid', 'flight.mode'], filters: ['filters'], physics: ['physics'], camera: ['camera', 'graphics'] };
    for (const p of map[this.tab] || []) setPath(this.config, p, deepClone(getPath(DEFAULT_CONFIG, p)));
    this._changed('all');
    this.render();
  }

  _export() {
    const blob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'agenticfpv-config.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  _import() {
    const inp = h('input', { type: 'file', accept: 'application/json' });
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const merged = deepMerge(DEFAULT_CONFIG, JSON.parse(await file.text()));
        for (const k of Object.keys(merged)) this.config[k] = merged[k];
        this._changed('all');
        this.render();
        this.onToast?.('Config imported ✔');
      } catch (err) {
        this.onToast?.(`Import failed: ${err.message}`);
      }
    });
    inp.click();
  }
}
