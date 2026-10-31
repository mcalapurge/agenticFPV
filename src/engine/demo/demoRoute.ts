// The demo flight over the Abandoned Works map: [x, y, z], origin on the map's launch pad (0, 0, 60).
// The structures it clears: concrete skeleton (x -55…-25, z -30…-10, 18 m), brick warehouse
// (x 18…62, z -36…-14, 9 m), tower (x -11…1, z -81…-69, ~35 m), smokestack (75, -75, 48 m),
// container yard (x -70…-28, z 25…55, ≤ 8 m) and the power line at x = 95 (11 m).

import type { Waypoint } from './demoPilot';

export const DEMO_ROUTE: readonly Waypoint[] = [
  // Take-off: punch up off the pad.
  { p: [0, 10, 46], speed: 8, radius: 5 },
  // The lap (the pilot loops back to here after the last waypoint).
  { p: [0, 13, 12], speed: 15, trick: 'roll' },
  { p: [-38, 26, 2], speed: 15, trick: 'powerloop' }, // over the skeleton's south side
  { p: [-72, 22, -22], speed: 15, trick: 'backflip' }, // past its west end…
  { p: [-70, 6, 2], speed: 16 }, // …and dive down the side
  { p: [-62, 15, 30], speed: 14, trick: 'spin' }, // climb out over the container yard
  { p: [-25, 13, 52], speed: 15 },
  { p: [12, 14, 40], speed: 15, trick: 'flip' },
  { p: [45, 17, 30], speed: 15 }, // over the L-block
  { p: [82, 24, 5], speed: 15, trick: 'tumble' },
  // Corkscrew up the smokestack, approaching tangentially so the stack is never dead ahead.
  { p: [88, 30, -60], speed: 15 },
  { p: [93, 34, -76], speed: 15 },
  { p: [76, 38, -93], speed: 15, trick: 'powerloop' },
  { p: [58, 38, -76], speed: 15 },
  // Across the warehouse, up and over the tower, then dive off the far side.
  { p: [30, 20, -55], speed: 16 },
  { p: [28, 18, -25], speed: 15 },
  { p: [-2, 54, -75], speed: 15, trick: 'flip' },
  { p: [-30, 28, -100], speed: 16 },
  { p: [-30, 12, -60], speed: 15 },
  { p: [-8, 14, -20], speed: 15, trick: 'spin' },
];
