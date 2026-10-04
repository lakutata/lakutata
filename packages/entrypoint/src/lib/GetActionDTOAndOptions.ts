import {DTO} from '@lakutata/core'
import {ActionOptions} from './ActionOptions.js'
import {FlexibleDTO} from '@lakutata/core/dtos'

/**
 * Sort out the optional arguments of an action decorator (`(dto?)`, `(options?)` or `(dto, options)`): a function is
 * the DTO, an object the options. The options are validated, their defaults applied.
 * @param dtoConstructorOrOptions The DTO validating the action's input, or the action's options.
 * @param options The action's options, when the first argument is the DTO.
 * @returns The DTO (`FlexibleDTO`, accepting any input, when none is given) and the validated options.
 * @throws {Error} When the options are invalid (the validation error of {@link ActionOptions}).
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {FlexibleDTO} from 'lakutata/dtos'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {GetActionDTOAndOptions} from '@lakutata/entrypoint/channel'
 *
 * class SendDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public text: string
 * }
 *
 * const [dto, options] = GetActionDTOAndOptions(SendDTO, {name: 'send'})
 * console.log(dto === SendDTO, options.groups) //true []
 * const [anyInput] = GetActionDTOAndOptions({acl: true})
 * console.log(anyInput === FlexibleDTO) //true
 * ```
 */
export function GetActionDTOAndOptions<DTOConstructor extends typeof DTO = typeof DTO>(dtoConstructorOrOptions?: DTOConstructor | ActionOptions<any>, options?: ActionOptions<any>): [DTOConstructor | typeof FlexibleDTO, ActionOptions<any>] {
    let dtoConstructor: DTOConstructor | typeof FlexibleDTO = FlexibleDTO
    let actionOptions: ActionOptions<any> = {}
    if (options) {
        //The DTO may be omitted (undefined) before the options
        if (dtoConstructorOrOptions) dtoConstructor = dtoConstructorOrOptions as DTOConstructor
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