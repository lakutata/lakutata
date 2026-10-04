import {Exception} from '../lib/foundation/Exception.js'

/**
 * Thrown when the pattern of a service action (`@ServiceAction`) nests objects more than 2 levels deep.
 * Its errno is `E_INVALID_ACTION_PATTERN_DEPTH`.
 */
export class InvalidActionPatternDepthException extends Exception {
    public errno: string | number = 'E_INVALID_ACTION_PATTERN_DEPTH'
}
