// Controller tab with a fake simulator + scripted gamepad (no WebGL needed).

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PadSnapshot } from '../../src/engine/input/input';
import type { Simulator } from '../../src/engine/Simulator';
import { useConfigStore } from '../../src/state/configStore';
import { useEngineStore } from '../../src/state/engineStore';
import { useUiStore } from '../../src/state/uiStore';
import { ControllerTab } from '../../src/ui/menu/tabs/ControllerTab';

function fakeSim() {
  const frames = new Set<(s: Simulator) => void>();
  let pad: PadSnapshot = { id: 'Fake Radio', index: 0, axes: [0, 0, -1, 0, -1], buttons: [] };
  const sim = {
    rc: { throttle: 0.25, yaw: -0.5, pitch: 0, roll: 0.75, armSwitch: true, angleSwitch: null, turtleSwitch: false },
    input: { listGamepads: () => [pad], getGamepad: () => pad },
    onFrame: (fn: (s: Simulator) => void) => {
      frames.add(fn);
      return () => void frames.delete(fn);
    },
  };
  const api = {
    sim: sim as unknown as Simulator,
    /** Move sticks: [roll, pitch, throttle, yaw, SA]. */
    set(axes: number[]) {
      pad = { ...pad, axes };
      act(() => frames.forEach((f) => f(api.sim)));
    },
  };
  return api;
}

describe('Controller tab', () => {
  it('shows live channel bars and the detected pad', () => {
    const f = fakeSim();
    useEngineStore.getState().setSim(f.sim);
    render(<ControllerTab />);
    expect(screen.getByRole('option', { name: '#0 Fake Radio' })).toBeInTheDocument();
    expect(screen.getByTestId('bar-THROTTLE')).toHaveTextContent('25%');
    expect(screen.getByTestId('bar-ROLL')).toHaveTextContent('0.75');
    expect(screen.getByTestId('bar-Axis 4')).toHaveTextContent('-1.00');
  });

  it('runs the calibration wizard and saves the mapping', async () => {
    const f = fakeSim();
    useEngineStore.getState().setSim(f.sim);
    render(<ControllerTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration wizard' }));
    const next = () => userEvent.click(screen.getByRole('button', { name: /^(Next|Finish)$/ }));
    const centred = [0, 0, -1, 0, -1];
    const script: number[][] = [
      centred, // baseline
      [0, 0, 1, 0, -1], // throttle up
      centred,
      [0, 0, -1, 1, -1], // yaw right
      centred,
      [0, -1, -1, 0, -1], // pitch up (inverted)
      centred,
      [1, 0, -1, 0, -1], // roll right
    ];
    for (const axes of script) {
      f.set(axes);
      await next();
    }
    // Range step: stir the sticks.
    f.set([-0.9, -0.9, -0.95, -0.9, -1]);
    f.set([0.9, 0.9, 0.95, 0.9, -1]);
    await next();
    f.set(centred);
    await next();
    expect(screen.getByTestId('wizard')).toHaveTextContent('Step 11/11');
    f.set([0, 0, -1, 0, 1]); // flip SA
    await next();

    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
    const input = useConfigStore.getState().config.input;
    expect(input.channels.throttle).toMatchObject({ axis: 2, invert: false, min: -0.95, max: 0.95 });
    expect(input.channels.pitch).toMatchObject({ axis: 1, invert: true });
    expect(input.channels.yaw.axis).toBe(3);
    expect(input.channels.roll).toMatchObject({ axis: 0, min: -0.9, max: 0.9, center: 0 });
    expect(input.arm).toMatchObject({ type: 'axis', index: 4, threshold: 0 });
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe('Calibration saved ✔');
  });

  it('warns when a step sees no movement', async () => {
    const f = fakeSim();
    useEngineStore.getState().setSim(f.sim);
    render(<ControllerTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration wizard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('wizard')).toHaveTextContent('No stick movement detected');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
  });

  it('applies an input preset', async () => {
    useEngineStore.getState().setSim(fakeSim().sim);
    render(<ControllerTab />);
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'Gamepad (Mode 2, Xbox/PS layout)');
    const input = useConfigStore.getState().config.input;
    expect(input.channels.throttle).toMatchObject({ axis: 1, invert: true });
    expect(input.arm).toMatchObject({ type: 'button', index: 9, toggle: true });
  });
});
