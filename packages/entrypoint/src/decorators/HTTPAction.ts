import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator, DTO} from '@lakutata/core'
import {registerHTTPAction} from '../lib/ControllerEntrypoint.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {getActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {HTTPContext} from '../context/HTTPContext.js'

/**
 * Expose the controller method as an HTTP action answering a route for an HTTP method, served by the HTTP adapters of
 * the entrypoint (`expressHTTPEntrypoint`, `fastifyHTTPEntrypoint`). Without a DTO, the input is accepted as it is.
 *
 * On a request, the adapter assembles the input: by default, the query string merged with the parsed body (JSON; URL
 * encoded with Express), then the route parameters over them. The middlewares run, the input is validated against the
 * DTO (the defaults applied, the unknown keys removed), the access control runs when `acl` is set, then the method
 * receives the validated input as a plain object, not a DTO instance. The query values and the route parameters are
 * strings and the DTO schemas are strict: convert them with `.strict(false)` (`DTO.Number().strict(false)`).
 *
 * The value returned is answered by the adapter's responder: as JSON by default, with the status 204 for `undefined`;
 * return `Result.status()`, `Result.file()` or `Result.events()` for a status and headers, a file or server-sent
 * events. An error thrown is answered as `{errno, errMsg}` with the first 4xx `statusCode` along its causes (400 for an
 * invalid input), else its own `statusCode`, else 500.
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param method The HTTP method (`'get'`, `'post'`, `'put'`, `'patch'`, `'delete'`, `'head'`, `'options'`), in any
 * case; a method the adapter does not support fails its start.
 * @returns The method decorator.
 * @example
 * ```typescript
 * import {Application, DTO} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {HTTPAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 *
 * class SearchDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public keyword!: string
 *
 *     //A query value is a string: converted to a number
 *     @Expect(DTO.Number().integer().min(1).strict(false).optional().default(1))
 *     public page!: number
 * }
 *
 * class SearchController extends Controller {
 *     //GET /search?keyword=lamp&page=2, or POST /search with the body {"keyword": "lamp"}: answered with the JSON
 *     //{"keyword": "lamp", "page": 2}; without a keyword, the status 400 and {"errno": "E_INVALID_VALUE", "errMsg": …}
 *     @HTTPAction('/search', ['get', 'post'], SearchDTO)
 *     public async search(input: SearchDTO): Promise<{ keyword: string, page: number }> {
 *         return {keyword: input.keyword, page: input.page}
 *     }
 *
 *     //PURGE /cache, an access-controlled action: answered with the status 204 (no content)
 *     @HTTPAction('/cache', 'purge', {acl: true, name: 'Purge the cache'})
 *     public async purge(): Promise<void> {
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'search.app',
 *     name: 'Search',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [SearchController],
 *             http: expressHTTPEntrypoint({port: 8080})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, method: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for an HTTP method, its input validated against a
 * DTO. The input is the query string merged with the parsed body, then the route parameters over them (the default of
 * the adapters); the method receives it validated, as a plain object. The value returned is answered as JSON (204 for
 * `undefined`), an error as `{errno, errMsg}` with its status (400 for an invalid input, else 500 by default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param method The HTTP method (`'get'`, `'post'`…), in any case.
 * @param dtoConstructor The DTO class validating the input; the query values and the route parameters are strings,
 * convert them with `.strict(false)`.
 * @returns The method decorator.
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for an HTTP method, with action options; the input
 * is accepted as it is. The value returned is answered as JSON (204 for `undefined`), an error as `{errno, errMsg}`
 * with its status (500 by default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param method The HTTP method (`'get'`, `'post'`…), in any case.
 * @param actionOptions The action options: `acl` runs the access control rules (false by default); `name` (unique in the
 * HTTP actions, `ClassName:method` by default), `description` and `groups` describe the action; `rule` is an access
 * rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the method.
 * @returns The method decorator.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, method: string, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for an HTTP method, its input validated against a
 * DTO, with action options. The input is the query string merged with the parsed body, then the route parameters over
 * them (the default of the adapters); the method receives it validated, as a plain object. The value returned is
 * answered as JSON (204 for `undefined`), an error as `{errno, errMsg}` with its status (400 for an invalid input, else
 * 500 by default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param method The HTTP method (`'get'`, `'post'`…), in any case.
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
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for several HTTP methods; the input is accepted as
 * it is. The input is the query string merged with the parsed body, then the route parameters over them (the default
 * of the adapters). The value returned is answered as JSON (204 for `undefined`), an error as `{errno, errMsg}` with
 * its status (500 by default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param methods The HTTP methods (`['get', 'post']`), in any case; the action answers each of them.
 * @returns The method decorator.
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, methods: string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for several HTTP methods, its input validated
 * against a DTO. The input is the query string merged with the parsed body, then the route parameters over them (the
 * default of the adapters); the method receives it validated, as a plain object. The value returned is answered as
 * JSON (204 for `undefined`), an error as `{errno, errMsg}` with its status (400 for an invalid input, else 500 by
 * default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param methods The HTTP methods (`['get', 'post']`), in any case; the action answers each of them.
 * @param dtoConstructor The DTO class validating the input; the query values and the route parameters are strings,
 * convert them with `.strict(false)`.
 * @returns The method decorator.
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for several HTTP methods, with action options; the
 * input is accepted as it is. The value returned is answered as JSON (204 for `undefined`), an error as
 * `{errno, errMsg}` with its status (500 by default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param methods The HTTP methods (`['get', 'post']`), in any case; the action answers each of them.
 * @param actionOptions The action options: `acl` runs the access control rules (false by default); `name` (unique in the
 * HTTP actions, `ClassName:method` by default), `description` and `groups` describe the action; `rule` is an access
 * rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the method.
 * @returns The method decorator.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, methods: string[], actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as an HTTP action answering a route for several HTTP methods, its input validated
 * against a DTO, with action options. The input is the query string merged with the parsed body, then the route
 * parameters over them (the default of the adapters); the method receives it validated, as a plain object. The value
 * returned is answered as JSON (204 for `undefined`), an error as `{errno, errMsg}` with its status (400 for an invalid
 * input, else 500 by default).
 * @param route The route, in the syntax of the HTTP adapter (`/users/:id`); the controller's `@Prefix({route})` is
 * prepended to it.
 * @param methods The HTTP methods (`['get', 'post']`), in any case; the action answers each of them.
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
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>

export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, m: string | string[], dtoConstructorOrOptions?: DTOConstructor | ActionOptions<HTTPContext>, options?: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const route: string = r.toString()
        const methods: string[] = Array.isArray(m) ? m : [m]
        const [dtoConstructor, actionOptions] = getActionDTOAndOptions(dtoConstructorOrOptions, options)
        registerHTTPAction(route, methods, target, propertyKey, dtoConstructor, actionOptions)
        return descriptor
    }
}
