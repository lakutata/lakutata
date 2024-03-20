import {Exception} from '../lib/base/abstracts/Exception.js'

export class InvalidActionPatternDepthException extends Exception {
    public errno: string | number = 'E_INVALID_ACTION_PATTERN_DEPTH'
}
