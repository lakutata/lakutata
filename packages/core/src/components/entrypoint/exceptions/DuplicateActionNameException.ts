import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class DuplicateActionNameException extends Exception {
    public errno: string | number = 'E_DUPLICATE_ACTION_NAME'
}