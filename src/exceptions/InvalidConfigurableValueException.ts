import {Exception} from '../lib/base/abstracts/Exception'

export class InvalidConfigurableValueException extends Exception {
    public errno: number | string = 'E_INVALID_CONFIGURABLE_VALUE'
}
