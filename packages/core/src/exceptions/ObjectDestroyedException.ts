import {Exception} from '../lib/foundation/Exception.js'

export class ObjectDestroyedException extends Exception {
    public errno: string | number = 'E_OBJECT_DESTROYED'
}
