import { Blackbox } from './hud/Blackbox';
import { Osd } from './hud/Osd';
import { GpuWarning, Loading, Results, Toasts } from './hud/Overlays';
import { StickOverlay } from './hud/StickOverlay';
import { Menu } from './menu/Menu';

export function App() {
  return (
    <>
      <Osd />
      <StickOverlay />
      <Blackbox />
      <Toasts />
      <GpuWarning />
      <Results />
      <Menu />
      <Loading />
    </>
  );
}
