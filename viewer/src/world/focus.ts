// Shared "focus" brightness for the static environment. Drops below 1 while an incident is selected so the
// holographic overlays and the affected robots stand out (racks, walls and floor recede).
import { uniform } from 'three/tsl';

export const environmentBrightness = uniform(1);
