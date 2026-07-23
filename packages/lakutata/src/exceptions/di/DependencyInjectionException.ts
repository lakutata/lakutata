import {Exception} from '../../lib/base/abstracts/Exception.js'

export class DependencyInjectionException extends Exception {
    public errno: number | string = 'E_DEPENDENCY_INJECTION'
}
