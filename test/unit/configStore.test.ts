// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';

const STORAGE_KEY = 'agenticfpv.config.v2';

/** Fresh store module per test so persistence hydration runs again. */
async function loadStore() {
  vi.resetModules();
  return (await import('../../src/state/configStore')).useConfigStore;
}

beforeEach(() => localStorage.clear());

describe('config store', () => {
  it('starts from defaults', async () => {
    const store = await loadStore();
    expect(store.getState().config).toEqual(DEFAULT_CONFIG);
    expect(store.getState().config).not.toBe(DEFAULT_CONFIG);
  });

  it('updates through Immer recipes without mutating the previous state', async () => {
    const store = await loadStore();
    const before = store.getState().config;
    store.getState().update((d) => void (d.pid.roll.p = 61));
    const after = store.getState().config;
    expect(after.pid.roll.p).toBe(61);
    expect(before.pid.roll.p).toBe(45);
    expect(after.rates).toBe(before.rates); // structural sharing
  });

  it('sets by path and resets selected paths', async () => {
    const store = await loadStore();
    store.getState().setPath('physics.windSpeed', 7);
    store.getState().setPath('pid.roll.p', 70);
    store.getState().reset(['physics']);
    expect(store.getState().config.physics.windSpeed).toBe(DEFAULT_CONFIG.physics.windSpeed);
    expect(store.getState().config.pid.roll.p).toBe(70);
    store.getState().reset();
    expect(store.getState().config).toEqual(DEFAULT_CONFIG);
  });

  it('replace() validates imported config', async () => {
    const store = await loadStore();
    store.getState().replace({ pid: { roll: { p: 999 } }, nonsense: 1 });
    expect(store.getState().config.pid.roll.p).toBe(250);
    expect(store.getState().config).not.toHaveProperty('nonsense');
  });

  it('persists and rehydrates', async () => {
    const store = await loadStore();
    store.getState().setPath('rates.roll.rate', 800);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.config.rates.roll.rate).toBe(800);
    const again = await loadStore();
    expect(again.getState().config.rates.roll.rate).toBe(800);
  });

  it('migrates the legacy v1 bare config', async () => {
    localStorage.setItem('agenticfpv.config.v1', JSON.stringify({ pid: { roll: { p: 33 } }, rates: { type: 'betaflight' } }));
    const store = await loadStore();
    expect(store.getState().config.pid.roll.p).toBe(33);
    expect(store.getState().config.rates.type).toBe('betaflight');
    expect(store.getState().config.physics).toEqual(DEFAULT_CONFIG.physics);
  });

  it('survives corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const store = await loadStore();
    expect(store.getState().config).toEqual(DEFAULT_CONFIG);
  });

  it('re-validates stored values', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { config: { pid: { roll: { p: -10 } } } }, version: 2 }));
    const store = await loadStore();
    expect(store.getState().config.pid.roll.p).toBe(0);
    expect(store.getState().config.rates).toEqual(DEFAULT_CONFIG.rates);
  });
});
