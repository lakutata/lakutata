import {DTO, type ActionPattern} from '@lakutata/core'
import {Expect, IndexSignature} from '@lakutata/core/decorator/dto'
import {InvalidPrefixException} from '../exceptions/InvalidPrefixException.js'

/**
 * A controller's action prefixes, given to `@Prefix`. The packages of the other channels add their own prefix keys
 * (declaration merging); the keys are kept even when not declared here.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {CLIAction, GET, Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
 *
 * //GET /users/:id, the command user:get, the pattern {resource: 'user', act: 'get'}
 * @Prefix({route: '/users', command: 'user', pattern: {resource: 'user'}})
 * class UserController extends Controller {
 *     @GET('/:id')
 *     @CLIAction('get')
 *     @ServiceAction({act: 'get'})
 *     public async get(input: {id: string}): Promise<{id: string}> {
 *         return {id: input.id}
 *     }
 * }
 * ```
 */
@IndexSignature(DTO.Any())
export class PrefixOptions extends DTO {
    /**
     * The path prepended to the HTTP actions' routes, the slashes between them normalized (`/users` + `/:id` =
     * `/users/:id`).
     */
    @Expect(DTO.String().optional())
    public route?: string

    /**
     * The command prepended to the CLI actions' commands, joined by `:` (`user` + `get` = `user:get`; an empty
     * command gives the prefix alone).
     */
    @Expect(DTO.String().optional())
    public command?: string

    /**
     * The pattern merged into the service actions' patterns, deeply (`{resource: 'user'}` + `{act: 'get'}` =
     * `{resource: 'user', act: 'get'}`); a key the prefix and the pattern set to different values fails the
     * entrypoint's initialization with an `InvalidPrefixException`.
     */
    @Expect(DTO.Object().optional())
    public pattern?: ActionPattern
}

const CONTROLLER_PREFIX: symbol = Symbol('ENTRYPOINT.CONTROLLER.PREFIX')

/**
 * Set a controller class's prefixes, merged over the ones already set on the class (by the decorators of the other
 * channels). Used by `@Prefix` and by the prefix decorators of the packages providing a channel.
 * @param controller The controller class.
 * @param options The prefixes to set.
 * @throws {Error} When the merged prefixes are invalid (the validation error of {@link PrefixOptions}).
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {setPrefix} from '@lakutata/entrypoint/channel'
 *
 * //A decorator of a "queue" channel prefixing the topics of a controller
 * export function TopicPrefix(topic: string) {
 *     return (target: typeof Controller): void => setPrefix(target, {topic: topic})
 * }
 * ```
 */
export function setPrefix(controller: Function, options: PrefixOptions): void {
    const own: PrefixOptions | undefined = Reflect.getOwnMetadata(CONTROLLER_PREFIX, controller)
    Reflect.defineMetadata(CONTROLLER_PREFIX, PrefixOptions.validate({...own, ...options}), controller)
}

/**
 * Get a controller's prefixes: the ones of the class, or else of its nearest parent class declaring them (they are not
 * merged across the hierarchy).
 * @param controller The controller class.
 * @returns The prefixes, `undefined` when neither the class nor its parents declare any.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {Prefix} from 'lakutata/decorator/ctrl'
 * import {getPrefix} from '@lakutata/entrypoint/channel'
 *
 * @Prefix({route: '/users'})
 * class UserController extends Controller {
 * }
 *
 * class AdminController extends UserController {
 * }
 *
 * console.log(getPrefix(AdminController)?.route) //'/users'
 * ```
 */
export function getPrefix(controller: Function): PrefixOptions | undefined {
    for (let current: any = controller; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
        const prefix: PrefixOptions | undefined = Reflect.getOwnMetadata(CONTROLLER_PREFIX, current)
        if (prefix) return prefix
    }
    return undefined
}

/**
 * Join a route prefix and a route
 * @param prefix
 * @param route
 */
export function prefixRoute(prefix: string, route: string): string {
    const segments: string[] = [prefix, route].map((part: string): string => part.replace(/^\/+|\/+$/g, '')).filter(Boolean)
    return `/${segments.join('/')}`
}

/**
 * Join a command prefix and a command
 * @param prefix
 * @param command
 */
export function prefixCommand(prefix: string, command: string): string {
    return command ? `${prefix}:${command}` : prefix
}

/**
 * Merge a pattern prefix into a pattern, a key cannot have different values
 * @param prefix
 * @param pattern
 * @param path
 */
export function prefixPattern(prefix: ActionPattern, pattern: ActionPattern, path: string = ''): ActionPattern {
    const merged: ActionPattern = {...pattern}
    for (const [key, value] of Object.entries(prefix)) {
        if (!(key in merged)) {
            merged[key] = value
        } else if (value !== null && typeof value === 'object' && merged[key] !== null && typeof merged[key] === 'object') {
            merged[key] = prefixPattern(value, merged[key], `${path}${key}.`)
        } else if (merged[key] !== value) {
            throw new InvalidPrefixException('The pattern prefix sets "{key}" to {prefix}, the pattern sets it to {pattern}', {
                key: `${path}${key}`,
                prefix: JSON.stringify(value),
                pattern: JSON.stringify(merged[key])
            })
        }
    }
    return merged
}
