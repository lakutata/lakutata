import {Exception} from '../lib/foundation/Exception.js'

/**
 * Reserved for a failure to destroy the application's root container; the framework does not throw it at
 * present. Its errno is `E_DESTROY_RUNTIME_CONTAINER`.
 */
export class DestroyRuntimeContainerException extends Exception {
    public errno: string | number = 'E_DESTROY_RUNTIME_CONTAINER'
}
