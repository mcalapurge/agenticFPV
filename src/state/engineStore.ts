// Handle to the running simulator for React components (null until the world has loaded).

import { create } from 'zustand';
import type { Simulator } from '../engine/Simulator';

export const useEngineStore = create<{ sim: Simulator | null; setSim: (sim: Simulator | null) => void }>()((set) => ({
  sim: null,
  setSim: (sim) => set({ sim }),
}));

export const useSim = () => useEngineStore((s) => s.sim);
