import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../src/state/uiStore';
import { isStandalone, platformOf } from '../../src/ui/pwa';
import { TitleScreen } from '../../src/ui/title/TitleScreen';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

interface Env {
  ua: string;
  touch?: boolean;
  standalone?: boolean;
  iosStandalone?: boolean;
}

function device({ ua, touch = true, standalone = false, iosStandalone = false }: Env) {
  vi.stubGlobal('navigator', {
    userAgent: ua,
    platform: /iPhone/.test(ua) ? 'iPhone' : 'Linux x86_64',
    maxTouchPoints: touch ? 5 : 0,
    getGamepads: () => [],
    ...(iosStandalone ? { standalone: true } : {}),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches:
      (q === '(pointer: coarse)' && touch) ||
      (q === '(hover: hover)' && !touch) ||
      (q === '(display-mode: standalone)' && standalone),
  }));
  useUiStore.getState().setLoading(null);
}

afterEach(() => vi.unstubAllGlobals());

describe('platformOf', () => {
  it.each([
    [IPHONE, 'iPhone', 5, 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)', 'iPad', 5, 'ios'],
    [DESKTOP, 'MacIntel', 5, 'ios'], // iPadOS pretends to be a Mac
    [DESKTOP, 'MacIntel', 0, 'other'], // a real Mac
    [PIXEL, 'Linux armv8l', 5, 'android'],
    [DESKTOP, 'Win32', 0, 'other'],
  ])('%s / %s / %s touch points → %s', (ua, platform, points, expected) => {
    expect(platformOf(ua, platform, points)).toBe(expected);
  });
});

describe('isStandalone', () => {
  it('is true for installed apps (display-mode, or iOS navigator.standalone), false in a browser tab', () => {
    device({ ua: PIXEL });
    expect(isStandalone()).toBe(false);
    device({ ua: PIXEL, standalone: true });
    expect(isStandalone()).toBe(true);
    device({ ua: IPHONE, iosStandalone: true });
    expect(isStandalone()).toBe(true);
  });
});

describe('install hint on the title screen', () => {
  it('iPhone: shows the Share → Add to Home Screen steps', async () => {
    device({ ua: IPHONE });
    render(<TitleScreen />);
    const hint = screen.getByTestId('install-hint');
    expect(hint).toHaveTextContent('Install as an app');
    await userEvent.click(screen.getByText(/Install as an app/));
    expect(hint).toHaveTextContent('Share');
    expect(hint).toHaveTextContent('Add to Home Screen');
  });

  it('Android without a browser prompt: shows the menu path', async () => {
    device({ ua: PIXEL });
    render(<TitleScreen />);
    await userEvent.click(screen.getByText(/Install as an app/));
    expect(screen.getByTestId('install-hint')).toHaveTextContent(/Install app|Add to Home screen/);
    expect(screen.getByTestId('install-hint')).not.toHaveTextContent('Share');
  });

  it('a desktop without an install prompt shows nothing', () => {
    device({ ua: DESKTOP, touch: false });
    render(<TitleScreen />);
    expect(screen.queryByTestId('install-hint')).not.toBeInTheDocument();
  });

  it('when the browser offers its install prompt, a real "Install app" button appears and works once', async () => {
    device({ ua: PIXEL });
    render(<TitleScreen />);
    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); // we keep the event for our own button
    await userEvent.click(screen.getByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledOnce();
    // A prompt can only be used once: the button goes away (the manual steps return).
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
  });

  it('the install button also shows on a desktop browser that supports installing', () => {
    device({ ua: DESKTOP, touch: false });
    render(<TitleScreen />);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    act(() => void window.dispatchEvent(event));
    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument();
  });

  it('hides everything once the app is installed (home-screen launch), and when it gets installed', () => {
    device({ ua: IPHONE, iosStandalone: true });
    const { unmount } = render(<TitleScreen />);
    expect(screen.queryByTestId('install-hint')).not.toBeInTheDocument();
    unmount();

    device({ ua: PIXEL });
    render(<TitleScreen />);
    expect(screen.getByTestId('install-hint')).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(screen.queryByTestId('install-hint')).not.toBeInTheDocument();
  });

  it('an installed app is already fullscreen, so the Fullscreen button goes away', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    device({ ua: PIXEL });
    const { unmount } = render(<TitleScreen />);
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
    unmount();
    device({ ua: PIXEL, standalone: true });
    render(<TitleScreen />);
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).not.toBeInTheDocument();
  });
});
