import { expect, frames, test } from './fixtures';

test('boots, renders the map and shows the OSD', async ({ app }) => {
  await frames(app, 3);
  const info = await app.evaluate(() => {
    const { sim } = window.__fpv!;
    let triangles = 0;
    sim.scene.traverse((o) => {
      const m = o as import('three').Mesh & { count?: number; isInstancedMesh?: boolean };
      if (!m.isMesh || !m.visible) return;
      const g = m.geometry;
      const verts = g.index ? g.index.count : g.attributes.position.count;
      triangles += (verts / 3) * (m.isInstancedMesh ? (m.count ?? 1) : 1);
    });
    return {
      triangles,
      programs: sim.renderer.info.programs?.length ?? 0,
      textures: sim.renderer.info.memory.textures,
      boxes: sim.collision.boxes.length,
    };
  });
  expect(info.triangles).toBeGreaterThan(50_000);
  expect(info.programs).toBeGreaterThan(5);
  expect(info.textures).toBeGreaterThan(10);
  expect(info.boxes).toBeGreaterThan(50);
  await expect(app.getByTestId('osd-tl')).toContainText(/25\.\dV/);
  await expect(app.getByTestId('osd-tc')).toHaveText('DISARMED');
  await expect(app.getByTestId('osd-tr')).toContainText('ACRO');
});

test('warns about software rendering and can be dismissed', async ({ app }) => {
  const warning = app.getByRole('alert');
  await expect(warning).toContainText('Hardware acceleration is off');
  await expect(warning).toContainText('SwiftShader');
  await warning.getByRole('button', { name: 'Dismiss' }).click();
  await expect(warning).toBeHidden();
});

test('canvas fills the viewport and follows resizes', async ({ app }) => {
  await expect(app.locator('canvas#view')).toHaveJSProperty('clientWidth', 1280);
  await app.setViewportSize({ width: 800, height: 600 });
  await frames(app, 2);
  const aspect = await app.evaluate(() => window.__fpv!.sim.camera.aspect);
  expect(aspect).toBeCloseTo(800 / 600, 2);
});
