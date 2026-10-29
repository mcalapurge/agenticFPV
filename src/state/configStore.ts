// Global config store (Zustand + Immer + persist). The engine reads `getState().config` and
// subscribes to slices it needs to re-apply; React components select what they render.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, subscribeWithSelector, type PersistStorage, type StorageValue } from 'zustand/middleware';
import {
  DEFAULT_CONFIG,
  getPath,
  parseConfig,
  setPath,
  type Config,
  type ConfigPath,
  type PathValue,
} from './configSchema';

export const STORAGE_KEY = 'agenticfpv.config.v2';
const LEGACY_KEY = 'agenticfpv.config.v1'; // 0.1.x stored the bare config object here

type Persisted = { config: Config };

export interface ConfigState {
  config: Config;
  /** Mutate the config through an Immer draft. */
  update: (recipe: (draft: Config) => void) => void;
  /** Set one leaf (or sub-object) by dot path. */
  setPath: <P extends ConfigPath>(path: P, value: PathValue<Config, P>) => void;
  /** Restore defaults for the given paths (or everything). */
  reset: (paths?: ConfigPath[]) => void;
  /** Replace the whole config with validated input (import). */
  replace: (input: unknown) => void;
}

const storage: PersistStorage<Persisted> = {
  getItem(name) {
    try {
      const raw = localStorage.getItem(name);
      if (raw) return JSON.parse(raw) as StorageValue<Persisted>;
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) return { state: { config: parseConfig(JSON.parse(legacy)) }, version: 2 };
    } catch {
      /* storage blocked or corrupt → defaults */
    }
    return null;
  },
  setItem(name, value) {
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch {
      /* quota / private mode */
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

const clone = <T>(v: T): T => structuredClone(v);

export const useConfigStore = create<ConfigState>()(
  subscribeWithSelector(
    persist(
      immer((set) => ({
        config: clone(DEFAULT_CONFIG),
        update: (recipe) => set((s) => void recipe(s.config)),
        setPath: (path, value) => set((s) => setPath(s.config, path, value)),
        reset: (paths) =>
          set((s) => {
            if (!paths) {
              s.config = clone(DEFAULT_CONFIG);
              return;
            }
            for (const p of paths) setPath(s.config, p, clone(getPath(DEFAULT_CONFIG, p)));
          }),
        replace: (input) => set((s) => void (s.config = parseConfig(input))),
      })),
      {
        name: STORAGE_KEY,
        version: 2,
        storage,
        partialize: (s) => ({ config: s.config }),
        // Whatever is stored gets re-validated, so old/partial/corrupt settings never crash the sim.
        merge: (persisted, current) => ({ ...current, config: parseConfig((persisted as Partial<Persisted>)?.config) }),
      },
    ),
  ),
);

/** Non-React access for the engine. */
export const getConfig = (): Config => useConfigStore.getState().config;
