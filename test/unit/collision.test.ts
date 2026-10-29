import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../../src/engine/sim/collision';

const down = new Vector3(0, -1, 0);

describe('CollisionWorld.raycast', () => {
  const world = new CollisionWorld();
  world.addBox(new Vector3(5, 1, 0), new Vector3(1, 1, 1));

  it('hits the ground plane', () => {
    const g = world.raycast(new Vector3(0, 3, 0), down, 5);
    expect(g?.t).toBeCloseTo(3, 9);
    expect(g?.normal.y).toBe(1);
  });

  it('hits the top face of a box', () => {
    const b = world.raycast(new Vector3(5, 3, 0), down, 5);
    expect(b?.t).toBeCloseTo(1, 9);
    expect(b?.normal.y).toBeCloseTo(1, 9);
  });

  it('hits the side of a box with an outward normal', () => {
    const s = world.raycast(new Vector3(0, 1, 0), new Vector3(1, 0, 0), 10);
    expect(s?.t).toBeCloseTo(4, 9);
    expect(s?.normal.x).toBeCloseTo(-1, 9);
  });

  it('returns null beyond max distance', () => {
    expect(world.raycast(new Vector3(0, 3, 0), down, 2)).toBeNull();
  });

  it('respects box rotation', () => {
    const w = new CollisionWorld();
    w.ground = false;
    // 45° about Y: the face is now a corner pointing at the ray.
    w.addBox(
      new Vector3(0, 0, 0),
      new Vector3(1, 1, 1),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4),
    );
    const hit = w.raycast(new Vector3(-5, 0, 0), new Vector3(1, 0, 0), 10);
    expect(hit?.t).toBeCloseTo(5 - Math.SQRT2, 6);
  });
});

describe('CollisionWorld.countOccluders', () => {
  it('counts walls between two points', () => {
    const w = new CollisionWorld();
    for (const x of [10, 20, 30]) w.addBox(new Vector3(x, 2, 0), new Vector3(0.2, 3, 5));
    expect(w.countOccluders(new Vector3(0, 2, 0), new Vector3(40, 2, 0))).toBe(3);
    expect(w.countOccluders(new Vector3(0, 2, 0), new Vector3(15, 2, 0))).toBe(1);
    expect(w.countOccluders(new Vector3(0, 2, 0), new Vector3(40, 2, 0), 2)).toBe(2);
    expect(w.countOccluders(new Vector3(0, 10, 0), new Vector3(40, 10, 0))).toBe(0);
  });

  it('clear() empties the world', () => {
    const w = new CollisionWorld();
    w.addBox(new Vector3(10, 2, 0), new Vector3(1, 3, 5));
    w.clear();
    expect(w.boxes).toHaveLength(0);
    expect(w.countOccluders(new Vector3(0, 2, 0), new Vector3(40, 2, 0))).toBe(0);
  });
});
