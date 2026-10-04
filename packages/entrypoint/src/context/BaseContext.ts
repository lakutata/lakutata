import {DTO, type ActionPattern} from '@lakutata/core'
import {Expect, IndexSignature} from '@lakutata/core/decorator/dto'

/**
 * The kinds of the request contexts of the built-in channels, held by `BaseContext.type`.
 */
export enum ContextType {
    /**
     * A command of a CLI adapter (`CLIContext`).
     */
    CLI = 'CLI',
    /**
     * A request of an HTTP adapter (`HTTPContext`).
     */
    HTTP = 'HTTP',
    /**
     * A message of a service adapter: Socket.IO, JSON-RPC, Electron IPC, HTTP service (`ServiceContext`).
     */
    SERVICE = 'SERVICE',
    /**
     * A run of a scheduled action (`ScheduleContext`).
     */
    SCHEDULE = 'SCHEDULE'
}

export type ContextParams<T extends {} = {}> = T & Record<string, any>

/**
 * The context of a request: what an adapter knows about it, given to the controller (`this.context`), the middlewares
 * (`invocation.context`) and the access control rules. Each channel has its subclass (`HTTPContext`, `CLIContext`,
 * `ServiceContext`, `ScheduleContext`); test it with `instanceof` in an action serving several channels. A context is
 * a DTO: its properties are validated when it is created and when they change; it also holds the extra properties
 * given by its adapter (the Socket.IO socket, the JSON-RPC request), read by the adapters' helpers
 * (`SocketOfContext`…). The adapters create the contexts: an application only reads them.
 * @example
 * ```typescript
 * import {Controller, CLIContext, HTTPContext, ServiceContext} from 'lakutata/com/entrypoint'
 * import {CLIAction, GET, ServiceAction} from 'lakutata/decorator/ctrl'
 *
 * class VersionController extends Controller {
 *     //One action for the three channels: the context tells them apart
 *     @GET('/version')
 *     @CLIAction('version')
 *     @ServiceAction({act: 'version'})
 *     public async version(): Promise<{ version: string, via: string }> {
 *         let via: string = this.context.type
 *         if (this.context instanceof HTTPContext) via = `${this.context.method.toUpperCase()} ${this.context.route}`
 *         if (this.context instanceof CLIContext) via = `the command ${this.context.command}`
 *         if (this.context instanceof ServiceContext) via = `the client ${this.context.clientId ?? 'unknown'}`
 *         return {version: '1.0.0', via: via}
 *     }
 * }
 * ```
 */
@IndexSignature(DTO.Any())
export class BaseContext<T extends Record<string, any> = {}> extends DTO {
    /**
     * The kind of the context: a `ContextType` for the built-in channels, the context type declared by its channel for
     * the channels of other packages.
     */
    //The type of the context: one of ContextType for the built-in channels, the context type of their channel for the others
    @Expect(DTO.String().required())
    public readonly type: ContextType | string

    /**
     * The input of the action before its validation: for HTTP the query string merged with the parsed body (the route
     * parameters are merged over it when the action runs, not into it), for CLI the arguments and the options of the
     * command, for a service the message without the keys of the action's pattern, for a scheduled run an empty
     * object. A middleware may change it before the validation.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.Any()).required())
    public data: ActionPattern<T>

    /**
     * The language of the request (a BCP 47 tag such as `'zh-CN'`), set by the i18n middleware (`I18nMiddleware` of
     * `lakutata/com/i18n`): the validation errors of an invalid input are then written in it. Undefined without it.
     */
    //The language of the request (given by the i18n middleware): the errors of the validation of its input are in it
    @Expect(DTO.String().optional())
    public locale?: string

    /**
     * Create a context, validating its properties.
     * @param params The properties of the context: its `type`, its `data`, and those of its channel.
     * @throws {InvalidValueException} When a property is invalid or a required one is missing.
     */
    constructor(params: ContextParams) {
        super(params)
    }
}
