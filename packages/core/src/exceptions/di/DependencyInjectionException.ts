import {Exception} from '../../lib/foundation/Exception.js'

export class DependencyInjectionException extends Exception {
    public errno: number | string = 'E_DEPENDENCY_INJECTION'
}
