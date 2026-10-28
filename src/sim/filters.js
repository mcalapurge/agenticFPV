// Small DSP helpers used by the flight controller.

export class PT1 {
  constructor(cutoffHz = 100, dt = 0.001) {
    this.state = 0;
    this.setCutoff(cutoffHz, dt);
  }
  setCutoff(cutoffHz, dt) {
    if (!(cutoffHz > 0)) {
      this.k = 1; // filter disabled
      return;
    }
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.k = dt / (rc + dt);
  }
  apply(x) {
    this.state += this.k * (x - this.state);
    return this.state;
  }
  reset(v = 0) {
    this.state = v;
  }
}

/** Two cascaded PT1 stages (Betaflight-style "PT2"). */
export class PT2 {
  constructor(cutoffHz = 100, dt = 0.001) {
    this.a = new PT1(cutoffHz, dt);
    this.b = new PT1(cutoffHz, dt);
  }
  setCutoff(cutoffHz, dt) {
    // Correct the cutoff so the -3dB point stays where the user asked.
    const corrected = cutoffHz > 0 ? cutoffHz / 0.643 : 0;
    this.a.setCutoff(corrected, dt);
    this.b.setCutoff(corrected, dt);
  }
  apply(x) {
    return this.b.apply(this.a.apply(x));
  }
  reset(v = 0) {
    this.a.reset(v);
    this.b.reset(v);
  }
}
