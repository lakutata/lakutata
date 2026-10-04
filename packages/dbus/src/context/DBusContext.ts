import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext} from '@lakutata/entrypoint'
import {type DBusContextParams} from '../types/DBusContextParams.js'

/**
 * The `type` of every {@link DBusContext}: `'DBUS'`. A middleware or an access rule shared by several transports tells
 * the D-Bus calls apart with it.
 */
export const DBUS_CONTEXT_TYPE: string = 'DBUS'

/**
 * The context of a D-Bus method call: `this.context` of a controller action declared with `@DBusMethod` when a client
 * calls it through {@link DBusEntrypoint}. The adapter creates one per call; its `data` is the call's input (the entries
 * of its `a{sv}` dictionary). The variables of the object path template are not in the context: they are merged into
 * the action's input, as the route parameters of HTTP.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {DBusContext, DBusInterface, DBusMethod} from '@lakutata/dbus'
 *
 * @DBusInterface('com.example.Manager', {path: '/com/example/Manager'})
 * class ManagerController extends Controller {
 *     //Returns "com.example.Manager.Ping at /com/example/Manager"
 *     @DBusMethod('Ping', {returns: 's'})
 *     public async ping(): Promise<string> {
 *         const context: DBusContext = this.context as DBusContext
 *         return `${context.interface}.${context.member} at ${context.path}`
 *     }
 * }
 * ```
 */
export class DBusContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    /**
     * Always {@link DBUS_CONTEXT_TYPE} (`'DBUS'`).
     */
    @Expect(DTO.String().valid(DBUS_CONTEXT_TYPE).default(DBUS_CONTEXT_TYPE))
    public readonly type: string

    /**
     * The object path the client called (`'/com/example/Devices/A1'`).
     */
    @Expect(DTO.String().required())
    public readonly path: string

    /**
     * The name of the interface the client called (`'com.example.Device'`).
     */
    @Expect(DTO.String().required())
    public readonly interface: string

    /**
     * The name of the method the client called (`'Status'`).
     */
    @Expect(DTO.String().required())
    public readonly member: string

    /**
     * Create the context of a method call, validating its properties.
     * @param params The object path, the interface, the method and the input of the call.
     * @throws {InvalidValueException} When a property is missing or invalid.
     */
    constructor(params: DBusContextParams) {
        super(params)
    }
}
