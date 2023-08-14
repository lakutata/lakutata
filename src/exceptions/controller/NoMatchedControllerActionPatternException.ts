import {Exception} from '../../lib/base/abstracts/Exception.js'

export class NoMatchedControllerActionPatternException extends Exception {
    public errno: number | string = 'E_NO_MATCHED_CONTROLLER_ACTION_PATTERN'
}
