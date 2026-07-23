import {Exception} from '../lib/base/abstracts/Exception.js'

export class DestroyRuntimeContainerException extends Exception {
    public errno: string | number = 'E_DESTROY_RUNTIME_CONTAINER'
}
