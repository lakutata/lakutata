import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator, ActionPattern, DTO} from '@lakutata/core'
import {RegisterServiceAction} from '../lib/ControllerEntrypoint.js'
import {getActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {ServiceContext} from '../context/ServiceContext.js'

/**
 * Expose the controller method as a service action, addressed by a pattern that the messages of the service adapters
 * must match. Without a DTO, the input is accepted as it is.
 * A service adapter (`socketIOServiceEntrypoint`, `jsonRPCServiceEntrypoint`, `electronIPCServiceEntrypoint`,
 * `httpServiceEntrypoint`) receives a message, an object, and dispatches it to the action whose pattern it matches. The
 * input is the message without the keys of the pattern; the middlewares run, the input is validated against the DTO
 * (the defaults applied, the unknown keys removed), the access control runs when `acl` is set, then the method receives
 * the validated input as a plain object.
 * The value returned is sent back to the caller: `{success: true, error: null, payload}` for the Socket.IO, Electron
 * and HTTP service adapters, the `result` of the response for JSON-RPC. An error is sent as `{success: false, error,
 * payload: null}`, `error` holding its properties (`errno`, `errMsg`, `statusCode`, `message`…); JSON-RPC answers it as
 * an error response. A message no pattern matches fails with `ControllerActionNotFoundException`.
 * @param pattern The pattern of the action: an object (nested 2 levels at most) whose keys the messages must hold with
 * the same values; a string value may be a glob (`'user.*'`, `*` any characters, `?` one). The most specific pattern
 * matching a message wins. The controller's `@Prefix({pattern})` is merged into it.
 * @returns The method decorator.
 * @throws {InvalidActionPatternDepthException} When the class is declared, if the pattern is nested more than 2 levels.
 * @example
 * ```typescript
 * import {Application, DTO} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 *
 * class TransferDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public to!: string
 *
 *     @Expect(DTO.Number().positive().required())
 *     public amount!: number
 * }
 *
 * class AccountController extends Controller {
 *     //The message {resource: 'account', act: 'transfer', to: 'ada', amount: 5}: the input is {to: 'ada', amount: 5},
 *     //the caller receives {success: true, error: null, payload: {to: 'ada', amount: 5, done: true}}; without an
 *     //amount, {success: false, error: {errno: 'E_INVALID_VALUE', …}, payload: null}
 *     @ServiceAction({resource: 'account', act: 'transfer'}, TransferDTO, {acl: true})
 *     public async transfer(input: TransferDTO): Promise<{ to: string, amount: number, done: boolean }> {
 *         return {to: input.to, amount: input.amount, done: true}
 *     }
 *
 *     //Any message whose act starts with "audit.", its other keys accepted as they are
 *     @ServiceAction({resource: 'account', act: 'audit.*'})
 *     public async audit(input: Record<string, unknown>): Promise<void> {
 *         console.log(input)
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'bank.app',
 *     name: 'Bank',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [AccountController],
 *             service: socketIOServiceEntrypoint({port: 3000})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function ServiceAction<ClassPrototype extends Controller, Method>(pattern: ActionPattern): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as a service action addressed by a pattern, its input validated against a DTO. The input
 * is the message without the keys of the pattern; the method receives it validated, as a plain object. The value
 * returned is sent back as `{success: true, error: null, payload}`, an error as `{success: false, error, payload:
 * null}` (a JSON-RPC result or error response).
 * @param pattern The pattern of the action: an object (nested 2 levels at most) whose keys the messages must hold with
 * the same values; a string value may be a glob (`'user.*'`, `*` any characters, `?` one). The most specific pattern
 * matching a message wins. The controller's `@Prefix({pattern})` is merged into it.
 * @param dtoConstructor The DTO class validating the input: the message without the keys of the pattern.
 * @returns The method decorator.
 * @throws {InvalidActionPatternDepthException} When the class is declared, if the pattern is nested more than 2 levels.
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as a service action addressed by a pattern, with action options; the input, the message
 * without the keys of the pattern, is accepted as it is. The value returned is sent back as `{success: true, error:
 * null, payload}`, an error as `{success: false, error, payload: null}` (a JSON-RPC result or error response).
 * @param pattern The pattern of the action: an object (nested 2 levels at most) whose keys the messages must hold with
 * the same values; a string value may be a glob (`'user.*'`, `*` any characters, `?` one). The most specific pattern
 * matching a message wins. The controller's `@Prefix({pattern})` is merged into it.
 * @param actionOptions The action options: `acl` runs the access control rules (false by default); `name` (unique in
 * the service actions, `ClassName:method` by default), `description` and `groups` describe the action; `rule` is an
 * access rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the method.
 * @returns The method decorator.
 * @throws {InvalidActionPatternDepthException} When the class is declared, if the pattern is nested more than 2 levels.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function ServiceAction<ClassPrototype extends Controller, Method>(pattern: ActionPattern, actionOptions: ActionOptions<ServiceContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as a service action addressed by a pattern, its input validated against a DTO, with
 * action options. The input is the message without the keys of the pattern; the method receives it validated, as a
 * plain object. The value returned is sent back as `{success: true, error: null, payload}`, an error as `{success:
 * false, error, payload: null}` (a JSON-RPC result or error response).
 * @param pattern The pattern of the action: an object (nested 2 levels at most) whose keys the messages must hold with
 * the same values; a string value may be a glob (`'user.*'`, `*` any characters, `?` one). The most specific pattern
 * matching a message wins. The controller's `@Prefix({pattern})` is merged into it.
 * @param dtoConstructor The DTO class validating the input: the message without the keys of the pattern.
 * @param actionOptions The action options: `acl` runs the access control rules (false by default); `name` (unique in
 * the service actions, `ClassName:method` by default), `description` and `groups` describe the action; `rule` is an
 * access rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the method.
 * @returns The method decorator.
 * @throws {InvalidActionPatternDepthException} When the class is declared, if the pattern is nested more than 2 levels.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<ServiceContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>

export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<ServiceContext>, options?: ActionOptions<ServiceContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const [dtoConstructor, actionOptions] = getActionDTOAndOptions(dtoConstructorOrOptions, options)
        RegisterServiceAction(pattern, target, propertyKey, dtoConstructor, actionOptions)
        return descriptor
    }
}
