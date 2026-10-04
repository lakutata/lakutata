import {Exception} from '../lib/foundation/Exception.js'

/**
 * Thrown when a destroyed (or being destroyed) object or container is used: `getObject()`,
 * `buildObject()`, `createScope()`, `load()`, `get()`, or an initialization which a teardown interrupted. Its errno is
 * `E_OBJECT_DESTROYED`.
 */
export class ObjectDestroyedException extends Exception {
    public errno: string | number = 'E_OBJECT_DESTROYED'
}
