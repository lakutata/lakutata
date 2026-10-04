import type {DTO, MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import {ActionOptions, GetActionDTOAndOptions, RegisterControllerAction} from '@lakutata/entrypoint/channel'
import {DBusChannel} from '../channel/DBusChannel.js'
import type {DBusContext} from '../context/DBusContext.js'
import {SchemaSignature} from '../lib/Signature.js'

/**
 * The options of {@link DBusMethod}: the options of a controller action (`name`, `description`, `acl`, `rule`,
 * `groups`, `middlewares`), with the D-Bus type of the method's result.
 */
export type DBusMethodOptions = ActionOptions<DBusContext> & {
    /**
     * The type of the method's result: a DTO (a dictionary of variants, `a{sv}`) or a D-Bus signature (`'s'`, `'b'`,
     * `'x'`, `'v'`…). Without it, the type comes from the method's `@Return` schema: an object is `a{sv}`, a string
     * `s`, a boolean `b`, an integer or a bigint `x`, another number `d`, an array `av`, any other value a variant `v`.
     * @default the type of the `@Return` schema; without `@Return`, the method has no result
     */
    returns?: typeof DTO | string
}

/**
 * Serve a controller action as a method of the D-Bus interface its controller declares with `@DBusInterface`. A method
 * with a DTO takes one argument, a dictionary of variants (`a{sv}`) holding the DTO's properties; a method without one
 * takes no argument. The input goes through the entrypoint's middlewares, the DTO validation and the access control,
 * as in the other channels, and the variables of the object path template are merged into it.
 *
 * The result is encoded with the type of `returns` or of `@Return` (the dates as ISO strings, the `null` and
 * `undefined` values left out, since a variant has no null); a method with neither returns nothing. An error thrown by
 * the action is answered as a D-Bus error named after its `errno` (or its name), prefixed by the service name
 * (`com.example.DeviceService.E_OFFLINE`), with its message; an `errno` already containing dots is used as it is.
 * The same method may also carry the decorators of the other channels (`@ServiceAction`, `@GET`…).
 * @param name The name of the method (`'Reboot'`): letters, digits and `_`, not starting with a digit; 255 characters at
 * most. Unique in its interface.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if its name is invalid; when the adapter starts, if its controller
 * has no `@DBusInterface`.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {Expect, Return} from 'lakutata/decorator/dto'
 * import {DBusInterface, DBusMethod} from '@lakutata/dbus'
 *
 * class ConfigureDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public sn: string
 *
 *     @Expect(DTO.Number().integer().min(0).optional())
 *     public retries?: number
 * }
 *
 * @DBusInterface('com.example.Manager', {path: '/com/example/Manager'})
 * export class ManagerController extends Controller {
 *     //No argument, returns a string (s)
 *     @DBusMethod('Ping', {returns: 's'})
 *     public async ping(): Promise<string> {
 *         return 'pong'
 *     }
 *
 *     //One argument a{sv}, returns a dictionary a{sv} (the type of @Return)
 *     @DBusMethod('Configure', ConfigureDTO, {description: 'Configure a device'})
 *     @Return(ConfigureDTO)
 *     public async configure(input: ConfigureDTO): Promise<ConfigureDTO> {
 *         return input
 *     }
 *
 *     //No result
 *     @DBusMethod('Reset')
 *     public async reset(): Promise<void> {
 *     }
 * }
 * ```
 */
export function DBusMethod<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a method of the D-Bus interface its controller declares with `@DBusInterface`: its input
 * is the DTO, given by the client as one dictionary of variants (`a{sv}`); its result has the type of `@Return`.
 * The input goes through the entrypoint's middlewares, the DTO validation and the access control, and the variables
 * of the object path template are merged into it. An error thrown by the action is answered as a D-Bus error named
 * after its `errno`, prefixed by the service name (`com.example.DeviceService.E_OFFLINE`).
 * @param name The name of the method (`'Reboot'`): letters, digits and `_`, not starting with a digit; 255 characters at
 * most. Unique in its interface.
 * @param dtoConstructor The DTO of the method's input, given by the client as an `a{sv}` dictionary.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if its name is invalid; when the adapter starts, if its controller
 * has no `@DBusInterface`.
 */
export function DBusMethod<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a method of the D-Bus interface its controller declares with `@DBusInterface`, with
 * action options: it takes no argument; its result has the type of `returns` or of `@Return`.
 * The input goes through the entrypoint's middlewares, the DTO validation and the access control, and the variables
 * of the object path template are merged into it. An error thrown by the action is answered as a D-Bus error named
 * after its `errno`, prefixed by the service name (`com.example.DeviceService.E_OFFLINE`).
 * @param name The name of the method (`'Reboot'`): letters, digits and `_`, not starting with a digit; 255 characters at
 * most. Unique in its interface.
 * @param options The options of the action, and the type of its result (`returns`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if its name is invalid; when the adapter starts, if its controller
 * has no `@DBusInterface`.
 */
export function DBusMethod<ClassPrototype extends Controller, Method>(name: string, options: DBusMethodOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a method of the D-Bus interface its controller declares with `@DBusInterface`, with
 * action options: its input is the DTO, given by the client as one dictionary of variants (`a{sv}`); its result has the
 * type of `returns` or of `@Return`.
 * The input goes through the entrypoint's middlewares, the DTO validation and the access control, and the variables
 * of the object path template are merged into it. An error thrown by the action is answered as a D-Bus error named
 * after its `errno`, prefixed by the service name (`com.example.DeviceService.E_OFFLINE`).
 * @param name The name of the method (`'Reboot'`): letters, digits and `_`, not starting with a digit; 255 characters at
 * most. Unique in its interface.
 * @param dtoConstructor The DTO of the method's input, given by the client as an `a{sv}` dictionary.
 * @param options The options of the action, and the type of its result (`returns`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if its name is invalid; when the adapter starts, if its controller
 * has no `@DBusInterface`.
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
