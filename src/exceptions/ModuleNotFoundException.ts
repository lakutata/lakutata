import {Exception} from '../lib/base/abstracts/Exception'

export class ModuleNotFoundException extends Exception {
    public errno: number | string = 'E_MODULE_NOT_FOUND'
}
