import {Exception} from '../lib/foundation/Exception.js'

export class MethodNotFoundException extends Exception {
    public errno: string | number = 'E_METHOD_NOT_FOUND'
}
