import {Exception} from '../../lib/foundation/Exception.js'

export class OverridableObjectTargetConfigNotFoundException extends Exception {
    public errno: string | number = 'E_OVERRIDABLE_OBJECT_TARGET_CONFIG_NOT_FOUND'
}
