import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class InvalidActionGroupException extends Exception {
    public errno: string | number = 'E_INVALID_ACTION_GROUP'
}