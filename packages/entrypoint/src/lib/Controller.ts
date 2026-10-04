import {Provider, DTO} from '@lakutata/core'
import {Scoped, Configurable} from '@lakutata/core/decorator/di'
import {CLIContext} from '../context/CLIContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {BaseContext} from '../context/BaseContext.js'

/**
 * The names of a controller's own members (the ones {@link Controller} does not declare): the methods an action
 * decorator may be applied to.
 */
export type ControllerProperty<ClassPrototype extends Controller> = Exclude<keyof ClassPrototype, keyof Controller>

/**
 * The base class of the controllers: classes whose methods, decorated with the action decorators (`@GET`, `@POST`…,
 * `@CLIAction`, `@ServiceAction`, `@Schedule`), serve the entrypoint's requests. Give the controller classes to the
 * entrypoint's `controllers` option.
 *
 * A controller is scoped: each request creates its own instance in the request's container, with the request's
 * context and abort signal, and destroys it when the request ends; its injected providers are scoped to the request
 * too. An action method receives its input (the request's data merged with the address parameters, validated by the
 * action's DTO, its defaults applied) and returns the result the adapter outputs; the actions declared in a parent
 * class are served by the registered subclasses.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller, HTTPContext} from 'lakutata/com/entrypoint'
 * import {CLIAction, GET, ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 *
 * class FindUserDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public id: string
 * }
 *
 * class UserController extends Controller {
 *     //The same action over HTTP (GET /users/:id), the CLI (user-get --id 1) and the services ({act: 'user.get', id})
 *     @GET('/users/:id', FindUserDTO)
 *     @CLIAction('user-get', FindUserDTO)
 *     @ServiceAction({act: 'user.get'}, FindUserDTO)
 *     public async get(input: FindUserDTO): Promise<{id: string, via: string}> {
 *         this.signal?.throwIfAborted()
 *         const via: string = this.context instanceof HTTPContext ? this.context.request.headers['user-agent'] ?? 'http' : this.context.type
 *         return {id: input.id, via: via}
 *     }
 * }
 * ```
 */
@Scoped(true)
export class Controller extends Provider {

    /**
     * The request's context: an {@link HTTPContext}, {@link CLIContext}, {@link ServiceContext}, or the context of
     * another channel (`ScheduleContext`…); check its `type` or its class to tell them apart.
     * @protected
     */
    //The context is created (and validated) by the entrypoint, only its type is checked here: a context of any channel
    @Configurable(DTO.InstanceOf(BaseContext).required())
    protected readonly context: CLIContext | HTTPContext | ServiceContext | BaseContext

    /**
     * Aborts when the request is aborted: its client gone (the HTTP connection closed, the gRPC call cancelled), its
     * deadline passed, or the entrypoint stopping. Long-running actions should stop then: their result is dropped.
     * @protected
     */
    @Configurable(DTO.InstanceOf(AbortSignal).optional())
    protected readonly signal?: AbortSignal
}
