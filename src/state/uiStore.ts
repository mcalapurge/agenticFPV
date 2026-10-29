// Transient UI state (not persisted): menu, toasts, loading, race results, GPU info.

import { create } from 'zustand';

export type MenuTab = 'race' | 'quad' | 'controller' | 'rates' | 'pids' | 'filters' | 'physics' | 'camera' | 'help';

export interface Toast {
  id: number;
  message: string;
}

export interface RaceResults {
  trackName: string;
  quadName: string;
  total: number;
  holeshot: number | null;
  laps: number[];
  topSpeedKmh: number;
  rank: number;
  board: { total: number; best: number; date: string }[];
}

export interface GpuInfo {
  name: string;
  vendor: string;
  label: string;
  software: boolean;
  webgl2: boolean;
}

interface UiState {
  menuOpen: boolean;
  tab: MenuTab;
  toasts: Toast[];
  loading: string | null;
  results: RaceResults | null;
  gpu: GpuInfo | null;
  gpuWarningDismissed: boolean;
  blackbox: boolean;
  openMenu: (tab?: MenuTab) => void;
  closeMenu: () => void;
  toggleMenu: () => void;
  setTab: (tab: MenuTab) => void;
  toast: (message: string, ms?: number) => void;
  dismissToast: (id: number) => void;
  setLoading: (msg: string | null) => void;
  setResults: (r: RaceResults | null) => void;
  setGpu: (g: GpuInfo) => void;
  dismissGpuWarning: () => void;
  toggleBlackbox: () => void;
}

let nextToast = 1;

export const useUiStore = create<UiState>()((set, get) => ({
  menuOpen: false,
  tab: 'race',
  toasts: [],
  loading: 'Loading…',
  results: null,
  gpu: null,
  gpuWarningDismissed: false,
  blackbox: false,
  openMenu: (tab) => set((s) => ({ menuOpen: true, tab: tab ?? s.tab })),
  closeMenu: () => set({ menuOpen: false }),
  toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen })),
  setTab: (tab) => set({ tab }),
  toast: (message, ms = 2500) => {
    const id = nextToast++;
    // Only the newest toast is shown; keep the list short.
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message }] }));
    setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setResults: (results) => set({ results }),
  setGpu: (gpu) => set({ gpu }),
  dismissGpuWarning: () => set({ gpuWarningDismissed: true }),
  toggleBlackbox: () => set((s) => ({ blackbox: !s.blackbox })),
}));

export const toast = (message: string, ms?: number) => useUiStore.getState().toast(message, ms);
