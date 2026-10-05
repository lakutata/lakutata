import {cloneDeep} from '@lakutata/utils'
import {DTO, type ActionPattern} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {type ServiceContextParams} from '../types/ServiceContextParams.js'

/**
 * The context of a message received by a service adapter (`socketIOServiceEntrypoint`, `jsonRPCServiceEntrypoint`,
 * `electronIPCServiceEntrypoint`, `httpServiceEntrypoint`): `this.context` of a controller action declared with
 * `@ServiceAction`, when it runs for a message. Its `input` is the whole message, matched against the actions'
 * patterns; its `data` is the message without the keys of the matched pattern. The adapters' helpers give the
 * transport objects (`socketOfContext`, `httpRequestOfContext`, `ipcEventOfContext`, `jsonRPCRequestOfContext`).
 * @example
 * ```typescript
 * import {Controller, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 *
 * class ChatController extends Controller {
 *     //The message {act: 'join', room: 'lobby'}: answered with the payload {room: 'lobby', client: <the client id>}
 *     @ServiceAction({act: 'join'})
 *     public async join(input: { room: string }): Promise<{ room: string, client?: string }> {
 *         const client: string | undefined = this.context instanceof ServiceContext ? this.context.clientId : undefined
 *         return {room: input.room, client: client}
 *     }
 * }
 * ```
 */
export class ServiceContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    /**
     * Always `ContextType.SERVICE`.
     */
    @Expect(DTO.String().valid(ContextType.SERVICE).default(ContextType.SERVICE))
    public readonly type: ContextType

    /**
     * The message as received, matched against the actions' patterns: a copy of the data given at creation, which
     * keeps the keys of the pattern (they are removed from `data` once the action is matched), the nested ones
     * included.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.Any()).required())
    public input: ActionPattern<T>

    /**
     * The id of the client of the request (the renderer of an Electron window, a Socket.IO socket, an HTTP service
     * client): `Entrypoint.notify()` pushes events to it by this id. Undefined for the transports without clients.
     */
    @Expect(DTO.String().optional())
    public readonly clientId?: string

    /**
     * Create the context of a service message, validating its properties; `input` is set to a copy of `data`.
     * @param params The message (`data`), its client id, and the adapter's extra properties.
     * @throws {InvalidValueException} When a property is invalid or a required one is missing.
     */
    constructor(params: ContextParams<ServiceContextParams>) {
        //A deep copy: the pattern keys removed from the data once matched, nested ones included, stay in the input
        params = {...params, input: cloneDeep(params.data ?? {})}
        super(params)
    }
}
