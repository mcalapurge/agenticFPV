// Import a Betaflight CLI `diff all` / `dump` into the sim config.
// Supports multiple PID / rate profiles (uses the active ones, i.e. the last `profile N` / `rateprofile N`).

const AXES = ['roll', 'pitch', 'yaw'];

export function parseBetaflightCli(text) {
  const profiles = {};
  const rateprofiles = {};
  const global = {};
  const features = {};
  let profile = 0;
  let rateprofile = 0;
  let activeProfile = 0;
  let activeRate = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let m;
    if ((m = line.match(/^profile\s+(\d+)/i))) { profile = activeProfile = +m[1]; continue; }
    if ((m = line.match(/^rateprofile\s+(\d+)/i))) { rateprofile = activeRate = +m[1]; continue; }
    if ((m = line.match(/^feature\s+(-?)(\w+)/i))) { features[m[2].toUpperCase()] = m[1] !== '-'; continue; }
    if ((m = line.match(/^set\s+(\w+)\s*=\s*(.+)$/i))) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (/^(p|i|d|f|d_min)_(roll|pitch|yaw)$|^(iterm_limit|pidsum_limit|pidsum_limit_yaw|tpa_rate|tpa_breakpoint|angle_level_strength|angle_limit|dterm_lpf1_static_hz|iterm_relax|iterm_relax_cutoff)$/.test(key)) {
        (profiles[profile] ??= {})[key] = val;
      } else if (/rc_rate|srate|_expo$|^rates_type$|^thr_mid$|^thr_expo$|^throttle_limit_percent$|^tpa_rate$|^tpa_breakpoint$/.test(key)) {
        (rateprofiles[rateprofile] ??= {})[key] = val;
      } else {
        global[key] = val;
      }
    }
  }
  return { pid: profiles[activeProfile] || {}, rates: rateprofiles[activeRate] || {}, global, features, activeProfile, activeRate };
}

/** Apply parsed CLI values to config in place. Returns a list of human-readable changes. */
export function applyBetaflightCli(config, text) {
  const { pid, rates, global, features, activeProfile, activeRate } = parseBetaflightCli(text);
  const changes = [];
  const num = (v) => parseFloat(v);
  const set = (label, obj, key, value) => {
    if (value === undefined || Number.isNaN(value)) return;
    obj[key] = value;
    changes.push(`${label} = ${value}`);
  };

  for (const ax of AXES) {
    set(`${ax} P`, config.pid[ax], 'p', num(pid[`p_${ax}`]));
    set(`${ax} I`, config.pid[ax], 'i', num(pid[`i_${ax}`]));
    set(`${ax} D`, config.pid[ax], 'd', num(pid[`d_${ax}`]));
    set(`${ax} FF`, config.pid[ax], 'f', num(pid[`f_${ax}`]));
  }
  set('I-term limit', config.pid, 'iTermLimit', num(pid.iterm_limit));
  set('PID sum limit', config.pid, 'pidSumLimit', num(pid.pidsum_limit));
  set('PID sum limit yaw', config.pid, 'pidSumLimitYaw', num(pid.pidsum_limit_yaw));
  set('Angle strength', config.pid, 'angleStrength', num(pid.angle_level_strength));
  set('Angle limit', config.pid, 'angleLimit', num(pid.angle_limit));
  if (pid.iterm_relax) set('I-term relax', config.pid, 'itermRelax', !/^off$/i.test(pid.iterm_relax));
  // TPA lives in the PID profile on 4.3+, in the rate profile on older firmware.
  const tpaRate = pid.tpa_rate ?? rates.tpa_rate;
  const tpaBp = pid.tpa_breakpoint ?? rates.tpa_breakpoint;
  if (tpaRate !== undefined) set('TPA rate', config.pid, 'tpaRate', num(tpaRate) / 100);
  if (tpaBp !== undefined) set('TPA breakpoint', config.pid, 'tpaBreakpoint', Math.min(1, Math.max(0, (num(tpaBp) - 1000) / 1000)));
  if (pid.dterm_lpf1_static_hz !== undefined) set('D-term LPF', config.filters, 'dtermLpfHz', num(pid.dterm_lpf1_static_hz));
  if (global.gyro_lpf1_static_hz !== undefined) set('Gyro LPF', config.filters, 'gyroLpfHz', num(global.gyro_lpf1_static_hz));
  if (global.dshot_idle_value !== undefined) set('Motor idle', config.flight, 'motorIdle', num(global.dshot_idle_value) / 10000);
  if (features.AIRMODE !== undefined) set('Airmode', config.pid, 'airmode', features.AIRMODE);

  // Rates.
  const type = (rates.rates_type || '').toUpperCase();
  if (type === 'ACTUAL' || type === 'BETAFLIGHT') {
    config.rates.type = type === 'ACTUAL' ? 'actual' : 'betaflight';
    changes.push(`Rates type = ${config.rates.type}`);
  } else if (type) {
    changes.push(`⚠ rates_type ${type} not supported — converted as Betaflight rates`);
    config.rates.type = 'betaflight';
  }
  const actual = config.rates.type === 'actual';
  for (const ax of AXES) {
    const rc = rates[`${ax}_rc_rate`], sr = rates[`${ax}_srate`], ex = rates[`${ax}_expo`];
    // Actual: rc_rate = centre sensitivity / 10, srate = max rate / 10. Betaflight: both in hundredths.
    if (rc !== undefined) set(`${ax} rc rate`, config.rates[ax], 'rcRate', actual ? num(rc) * 10 : num(rc));
    if (sr !== undefined) set(`${ax} ${actual ? 'max rate' : 'super rate'}`, config.rates[ax], 'rate', actual ? num(sr) * 10 : num(sr));
    if (ex !== undefined) set(`${ax} expo`, config.rates[ax], 'expo', num(ex) / 100);
  }
  if (rates.thr_mid !== undefined) set('Throttle mid', config.rates, 'throttleMid', num(rates.thr_mid) / 100);
  if (rates.thr_expo !== undefined) set('Throttle expo', config.rates, 'throttleExpo', num(rates.thr_expo) / 100);
  if (rates.throttle_limit_percent !== undefined) set('Throttle limit', config.rates, 'throttleLimit', num(rates.throttle_limit_percent) / 100);
  if (changes.length) changes.unshift(`Using PID profile ${activeProfile}, rate profile ${activeRate}`);
  return changes;
}
