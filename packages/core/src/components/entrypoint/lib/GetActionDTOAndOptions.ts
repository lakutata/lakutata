import {DTO} from '../../../lib/core/DTO.js'
import {ActionOptions} from './ActionOptions.js'
import {FlexibleDTO} from '../../../lib/base/internal/FlexibleDTO.js'

/**
 * Get action's DTO and options from decorator
 * @param dtoConstructorOrOptions
 * @param options
 * @constructor
 */
export function GetActionDTOAndOptions<DTOConstructor extends typeof DTO = typeof DTO>(dtoConstructorOrOptions?: DTOConstructor | ActionOptions<any>, options?: ActionOptions<any>): [DTOConstructor | typeof FlexibleDTO, ActionOptions<any>] {
    let dtoConstructor: DTOConstructor | typeof FlexibleDTO = FlexibleDTO
    let actionOptions: ActionOptions<any> = {}
    if (dtoConstructorOrOptions && options) {
        dtoConstructor = dtoConstructorOrOptions as DTOConstructor
        actionOptions = options
    } else if (dtoConstructorOrOptions) {
        if (dtoConstructorOrOptions.constructor.name.toUpperCase() === 'FUNCTION') {
            dtoConstructor = dtoConstructorOrOptions as DTOConstructor
        } else {
            actionOptions = dtoConstructorOrOptions as ActionOptions<any>
        }
    }
    return [dtoConstructor, ActionOptions.validate(actionOptions)]
}