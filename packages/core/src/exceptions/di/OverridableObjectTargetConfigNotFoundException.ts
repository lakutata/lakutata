import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when a component or provider is declared without class in the module options while no
 * component or provider of the same name is declared by the module's initializer or by `Application.preset()` to
 * complete; it fails the module's initialization. Its errno is `E_OVERRIDABLE_OBJECT_TARGET_CONFIG_NOT_FOUND`.
 */
export class OverridableObjectTargetConfigNotFoundException extends Exception {
    public errno: string | number = 'E_OVERRIDABLE_OBJECT_TARGET_CONFIG_NOT_FOUND'
}
