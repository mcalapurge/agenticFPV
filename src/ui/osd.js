// Betaflight-style OSD, stick overlay and a mini "blackbox" setpoint/gyro trace.

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
export { fmtTime };

export class OSD {
  constructor(root, sticksCanvas, blackboxCanvas) {
    this.root = root;
    this.sticks = sticksCanvas;
    this.bb = blackboxCanvas;
    this.els = {};
    for (const k of ['tl', 'tr', 'bl', 'br', 'tc', 'center', 'warn', 'bc', 'lap']) {
      const el = document.createElement('div');
      el.className = `el ${k}`;
      root.append(el);
      this.els[k] = el;
    }
    this.els.center.textContent = '─┼─';
    this.history = [];
    this.bbVisible = false;
  }

  toggleBlackbox() {
    this.bbVisible = !this.bbVisible;
    this.bb.classList.toggle('show', this.bbVisible);
  }

  set(k, text) {
    if (this.els[k].textContent !== text) this.els[k].textContent = text;
  }

  update(s) {
    const { config, quad, fc, armed, flightTime, warning, lap } = s;
    this.root.style.display = config.camera.showOsd ? '' : 'none';
    const b = quad.battery;
    const cells = config.physics.cells;
    this.set('tl', `${b.voltage.toFixed(1)}V  ${(b.voltage / cells).toFixed(2)}v\n${b.current.toFixed(0).padStart(3)}A ${b.usedMah.toFixed(0)}mAh`);
    this.set('tr', `${fmtTime(flightTime)}\n${config.flight.mode === 'angle' ? 'ANGL' : 'ACRO'}`);
    this.set('bl', `${quad.speedKmh.toFixed(0).padStart(3)} KM/H\n${quad.pos.y.toFixed(1).padStart(5)} M`);
    this.set('br', `THR ${(fc.throttle * 100).toFixed(0).padStart(3)}%`);
    this.set('tc', armed ? '' : 'DISARMED');
    const w = this.els.warn;
    w.textContent = warning || '';
    w.classList.toggle('blink', !!warning);
    this.set('lap', lap || '');
    this.set('bc', '');

    // Sticks overlay (Mode 2)
    const cs = this.sticks;
    cs.style.display = config.camera.showSticks ? '' : 'none';
    if (config.camera.showSticks) {
      const ctx = cs.getContext('2d');
      const W = cs.width, H = cs.height, r = 48;
      ctx.clearRect(0, 0, W, H);
      const rc = s.rc;
      const box = (cx, x, y) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - r, H / 2 - r, r * 2, r * 2);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx + x * r, H / 2 - y * r, 6, 0, Math.PI * 2);
        ctx.fill();
      };
      box(W / 2 - 70, rc.yaw, rc.throttle * 2 - 1);
      box(W / 2 + 70, rc.roll, rc.pitch);
    }

    // Blackbox trace
    this.history.push([fc.setpoint[0], fc.gyro[0], fc.setpoint[1], fc.gyro[1], fc.setpoint[2], fc.gyro[2]]);
    if (this.history.length > 240) this.history.shift();
    if (this.bbVisible) this._drawBlackbox();
  }

  _drawBlackbox() {
    const ctx = this.bb.getContext('2d');
    const W = this.bb.width, H = this.bb.height;
    ctx.clearRect(0, 0, W, H);
    const rows = ['ROLL', 'PITCH', 'YAW'];
    const rh = H / 3;
    let max = 200;
    for (const h of this.history) for (const v of h) max = Math.max(max, Math.abs(v));
    ctx.font = '11px monospace';
    rows.forEach((name, r) => {
      const mid = rh * r + rh / 2;
      ctx.strokeStyle = '#333';
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
      for (const [idx, col] of [[r * 2, '#ffcc00'], [r * 2 + 1, '#22c8ff']]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.history.forEach((h, i) => {
          const x = (i / 240) * W, y = mid - (h[idx] / max) * (rh / 2 - 4);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      ctx.fillStyle = '#ccc';
      ctx.fillText(name, 4, rh * r + 12);
    });
    ctx.fillStyle = '#ffcc00';
    ctx.fillText('setpoint', W - 120, 12);
    ctx.fillStyle = '#22c8ff';
    ctx.fillText('gyro', W - 50, 12);
  }
}
