// Real multi-touch for Playwright: drives Chrome's touch input through the DevTools protocol, so two
// thumbs can be on the two sticks at once (Playwright's own touchscreen only supports taps).

import type { CDPSession, Page } from '@playwright/test';

export class Fingers {
  private readonly active = new Map<number, { x: number; y: number }>();

  private readonly cdp: CDPSession;

  private constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  static async attach(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private send(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<unknown> {
    // The protocol wants every finger that is down; it works out which one changed.
    const touchPoints = [...this.active].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.active.set(id, { x, y });
    await this.send('touchStart');
  }

  async move(id: number, x: number, y: number): Promise<void> {
    this.active.set(id, { x, y });
    await this.send('touchMove');
  }

  /** Drag a finger in a few steps (a single jump is not how thumbs move). */
  async drag(id: number, from: [number, number], to: [number, number], steps = 4): Promise<void> {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.move(id, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    }
  }

  async up(id: number): Promise<void> {
    this.active.delete(id);
    await this.send('touchEnd');
  }
}
