// Menu tabs and which config sections each tab's "Reset to defaults" restores.

import type { ComponentType } from 'react';
import type { ConfigPath } from '../../state/configSchema';
import type { MenuTab } from '../../state/uiStore';
import { ControllerTab } from './tabs/ControllerTab';
import { PidsTab } from './tabs/PidsTab';
import { QuadTab } from './tabs/QuadTab';
import { RaceTab } from './tabs/RaceTab';
import { RatesTab } from './tabs/RatesTab';
import { CameraTab, FiltersTab, HelpTab, PhysicsTab } from './tabs/SimpleTabs';

export const TABS: { id: MenuTab; label: string; Component: ComponentType; resets: ConfigPath[] }[] = [
  { id: 'race', label: 'Race', Component: RaceTab, resets: ['game'] },
  { id: 'quad', label: 'Quad', Component: QuadTab, resets: [] },
  { id: 'controller', label: 'Controller', Component: ControllerTab, resets: ['input'] },
  { id: 'rates', label: 'Rates', Component: RatesTab, resets: ['rates', 'flight.motorIdle'] },
  { id: 'pids', label: 'PIDs', Component: PidsTab, resets: ['pid', 'flight.mode'] },
  { id: 'filters', label: 'Filters', Component: FiltersTab, resets: ['filters'] },
  { id: 'physics', label: 'Physics', Component: PhysicsTab, resets: ['physics'] },
  { id: 'camera', label: 'Video, Env & Audio', Component: CameraTab, resets: ['camera', 'video', 'audio', 'graphics'] },
  { id: 'help', label: 'Help', Component: HelpTab, resets: [] },
];
