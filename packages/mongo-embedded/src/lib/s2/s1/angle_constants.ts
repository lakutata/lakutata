// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from './angle.js'

// angle units.
export const DEGREE: Angle = Math.PI / 180
export const E5: Angle = 1e-5 * DEGREE
export const E6: Angle = 1e-6 * DEGREE
export const E7: Angle = 1e-7 * DEGREE
