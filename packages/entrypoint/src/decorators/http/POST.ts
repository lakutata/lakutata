import {Controller, type ControllerProperty} from '../../lib/Controller.js'
import {DTO, MethodDecorator} from '@lakutata/core'
import {HTTPAction} from '../HTTPAction.js'
import {ActionOptions} from '../../lib/ActionOptions.js'
import {HTTPContext} from '../../context/HTTPContext.js'

/**
 * Expose the controller method as an HTTP POST action on a route, to create a resource or run a command: the shorthand
 * of `@HTTPAction(route, 'post', …)`. The adapter assembles the input: by default, the query string merged with the
 * parsed body (JSON or URL encoded), then the route parameters over them. The middlewares run, the input is validated
 * against the DTO (the defaults applied, the unknown keys removed; without a DTO, it is accepted as it is), the access
 * control runs when `acl` is set, then the method receives the validated input as a plain object. The query values and
 * the route parameters are strings and the DTO schemas are strict: convert them with `.strict(false)`. The value
 * returned is answered by the adapter's responder: as JSON by default, with the status 204 for `undefined`;
 * `Result.status()` sets a status and headers. An error thrown is answered as `{errno, errMsg}` with the first 4xx
 * `statusCode` along its causes (400 for an invalid input), else its own `statusCode`, else 500.
 * @param r The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @returns The method decorator.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller, Result, type StatusResult} from 'lakutata/com/entrypoint'
 * import {POST} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 *
 * class CreateUserDTO extends DTO {
 *     @Expect(DTO.String().email().required())
 *     public email!: string
 *
 *     @Expect(DTO.String().min(1).required())
 *     public name!: string
 * }
 *
 * class UserController extends Controller {
 *     //POST /users with the body {"email": "ada@example.com", "name": "Ada"}: answered with the status 201 and the JSON
 *     //{"id": 1, "email": "ada@example.com", "name": "Ada"}; an invalid body with the status 400
 *     @POST('/users', CreateUserDTO, {acl: true, name: 'Create a user'})
 *     public async create(input: CreateUserDTO): Promise<StatusResult> {
 *         return Result.status(201, {id: 1, email: input.email, name: input.name})
 *     }
 * }
 * ```
 */
export function POST<ClassPrototype extends Controller, Method>(r: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP POST action on a route, its input validated against a DTO: the shorthand of
 * `@HTTPAction(route, 'post', …)`. The input is the query string merged with the parsed body, then the route parameters
 * over them (the default of the adapters); the method receives it validated, as a plain object. The value returned is
 * answered as JSON (204 for `undefined`), an error as `{errno, errMsg}` with its status (400 for an invalid input, else
 * 500 by default).
 * @param r The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param dtoConstructor The DTO class validating the input; the query values and the route parameters are strings,
 * convert them with `.strict(false)`.
 * @returns The method decorator.
 */
export function POST<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP POST action on a route, with action options: the shorthand of
 * `@HTTPAction(route, 'post', …)`. The input is the query string merged with the parsed body, then the route parameters
 * over them (the default of the adapters), accepted as it is. The value returned is answered as JSON (204 for
 * `undefined`), an error as `{errno, errMsg}` with its status (500 by default).
 * @param r The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param actionOptions The action options: `acl` runs the access control rules (false by default); `name` (unique in the
 * HTTP actions, `ClassName:method` by default), `description` and `groups` describe the action; `rule` is an access
 * rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the method.
 * @returns The method decorator.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function POST<ClassPrototype extends Controller, Method>(r: string, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP POST action on a route, its input validated against a DTO, with action
 * options: the shorthand of `@HTTPAction(route, 'post', …)`. The input is the query string merged with the parsed body,
 * then the route parameters over them (the default of the adapters); the method receives it validated, as a plain
 * object. The value returned is answered as JSON (204 for `undefined`), an error as `{errno, errMsg}` with its status
 * (400 for an invalid input, else 500 by default).
 * @param r The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param dtoConstructor The DTO class validating the input; the query values and the route parameters are strings,
 * convert them with `.strict(false)`.
 * @param actionOptions The action options: `acl` runs the access control rules (false by default); `name` (unique in the
 * HTTP actions, `ClassName:method` by default), `description` and `groups` describe the action; `rule` is an access
 * rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the method.
 * @returns The method decorator.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function POST<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function POST<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<HTTPContext>, options?: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return HTTPAction<ClassPrototype, Method, DTOConstructor>(r, 'post', <any>dtoConstructorOrOptions, <any>options)
}