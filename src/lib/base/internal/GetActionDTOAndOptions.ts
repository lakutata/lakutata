import {DTO} from '../../core/DTO.js'
import {ActionOptions} from './ActionOptions.js'
import {FlexibleDTO} from './FlexibleDTO.js'

/**
 * Get action's DTO and options from decorator
 * @param dtoConstructorOrOptions
 * @param options
 * @constructor
 */
export function GetActionDTOAndOptions<DTOConstructor extends typeof DTO = typeof DTO>(dtoConstructorOrOptions?: DTOConstructor | ActionOptions, options?: ActionOptions): [DTOConstructor | typeof FlexibleDTO, ActionOptions] {
    let dtoConstructor: DTOConstructor | typeof FlexibleDTO = FlexibleDTO
    let actionOptions: ActionOptions = {}
    if (dtoConstructorOrOptions && options) {
        dtoConstructor = dtoConstructorOrOptions as DTOConstructor
        actionOptions = options
    } else if (dtoConstructorOrOptions) {
        if (dtoConstructorOrOptions.constructor.name.toUpperCase() === 'FUNCTION') {
            dtoConstructor = dtoConstructorOrOptions as DTOConstructor
        } else {
            actionOptions = dtoConstructorOrOptions as ActionOptions
        }
    }
    return [dtoConstructor, ActionOptions.validate(actionOptions)]
}