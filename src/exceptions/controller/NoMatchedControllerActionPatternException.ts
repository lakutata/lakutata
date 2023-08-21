import {Exception} from '../../lib/base/abstracts/Exception'

export class NoMatchedControllerActionPatternException extends Exception {
    public errno: number | string = 'E_NO_MATCHED_CONTROLLER_ACTION_PATTERN'
}
