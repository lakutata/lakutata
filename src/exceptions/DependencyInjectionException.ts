import {Exception} from '../lib/base/abstracts/Exception'

export class DependencyInjectionException extends Exception {
    public errno: number | string = 'E_DEPENDENCY_INJECTION'
}
