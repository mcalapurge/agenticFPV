// Component-test setup (jsdom): jest-dom matchers, DOM cleanup and fresh stores per test.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/state/configSchema';
import { useConfigStore } from '../src/state/configStore';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';

const initialUi = useUiStore.getState();

// jsdom has no 2D canvas; components that draw (rate graph, blackbox) skip drawing when it's null.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  localStorage.clear();
  useConfigStore.setState({ config: structuredClone(DEFAULT_CONFIG) });
  useUiStore.setState(initialUi, true);
  useEngineStore.setState({ sim: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
