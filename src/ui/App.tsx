import { Blackbox } from './hud/Blackbox';
import { Osd } from './hud/Osd';
import { GpuWarning, Loading, Results, Toasts } from './hud/Overlays';
import { StickOverlay } from './hud/StickOverlay';
import { Menu } from './menu/Menu';
import { DemoOverlay } from './title/DemoOverlay';
import { TitleScreen } from './title/TitleScreen';
import { TouchControls } from './touch/TouchControls';

export function App() {
  return (
    <>
      <Osd />
      <StickOverlay />
      <Blackbox />
      <Toasts />
      <GpuWarning />
      <Results />
      <TouchControls />
      <TitleScreen />
      <DemoOverlay />
      <Menu />
      <Loading />
    </>
  );
}
