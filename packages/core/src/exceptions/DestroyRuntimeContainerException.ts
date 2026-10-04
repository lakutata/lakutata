import {Exception} from '../lib/foundation/Exception.js'

/**
 * A failure to destroy the application's root container, in 2.x. Its errno is `E_DESTROY_RUNTIME_CONTAINER`.
 * @deprecated Never thrown since 3.0: the errors of the teardown of the objects are reported to the application's
 * logger, and `Application.exit()` ends the process with the code 1 when the teardown fails. Kept for the code
 * catching it; it will be removed.
 */
export class DestroyRuntimeContainerException extends Exception {
    public errno: string | number = 'E_DESTROY_RUNTIME_CONTAINER'
}
