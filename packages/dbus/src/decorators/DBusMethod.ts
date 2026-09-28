import type {DTO, MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import {ActionOptions, GetActionDTOAndOptions, RegisterControllerAction} from '@lakutata/entrypoint/channel'
import {DBusChannel} from '../channel/DBusChannel.js'
import type {DBusContext} from '../context/DBusContext.js'
import {SchemaSignature} from '../lib/Signature.js'

/**
 * The options of a DBus method: the options of an action, with the signature of its result
 */
export type DBusMethodOptions = ActionOptions<DBusContext> & {
    /**
     * The result of the method: a DTO (a dictionary of variants) or a signature ("s", "b", "v"…).
     * By default the schema of @Return of the method, or no result
     */
    returns?: typeof DTO | string
}

/**
 * Method Decorator, serve the action as a method of the DBus interface of its controller (@DBusInterface):
 * its input is the DTO, given as one dictionary of variants (a{sv})
 * @param name the name of the method ("Reboot")
 */
export function DBusMethod<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a method of the DBus interface of its controller (@DBusInterface):
 * its input is the DTO, given as one dictionary of variants (a{sv})
 * @param name the name of the method ("Reboot")
 * @param dtoConstructor
 */
export function DBusMethod<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a method of the DBus interface of its controller (@DBusInterface):
 * its input is the DTO, given as one dictionary of variants (a{sv})
 * @param name the name of the method ("Reboot")
 * @param options
 */
export function DBusMethod<ClassPrototype extends Controller, Method>(name: string, options: DBusMethodOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a method of the DBus interface of its controller (@DBusInterface):
 * its input is the DTO, given as one dictionary of variants (a{sv})
 * @param name the name of the method ("Reboot")
 * @param dtoConstructor
 * @param options
 */
export function DBusMethod<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor, options: DBusMethodOptions): MethodDecorator<ClassPrototype, Method, any>
export function DBusMethod<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructorOrOptions?: DTOConstructor | DBusMethodOptions, options?: DBusMethodOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const isDTO: boolean = typeof dtoConstructorOrOptions === 'function'
        const {returns, ...actionOptions} = (isDTO ? options : dtoConstructorOrOptions as DBusMethodOptions | undefined) ?? {}
        const [dtoConstructor, validatedOptions] = isDTO
            ? GetActionDTOAndOptions(dtoConstructorOrOptions as DTOConstructor, actionOptions)
            : GetActionDTOAndOptions(actionOptions)
        const pattern: Record<string, string> = {member: name}
        if (returns !== undefined) pattern.returns = typeof returns === 'string' ? returns : SchemaSignature(returns)
        RegisterControllerAction(DBusChannel, target, propertyKey as never, pattern, dtoConstructor, validatedOptions)
        return descriptor
    }
}
