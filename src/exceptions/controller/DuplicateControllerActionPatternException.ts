import {Exception} from '../../lib/base/abstracts/Exception.js'

export class DuplicateControllerActionPatternException extends Exception {
    public errno: number | string = 'E_DUPLICATE_CONTROLLER_ACTION_PATTERN'
}
