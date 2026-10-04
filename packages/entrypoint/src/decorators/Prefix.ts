import {Controller} from '../lib/Controller.js'
import {PrefixOptions, SetPrefix} from '../lib/Prefix.js'

/**
 * Prefix the addresses of a controller's actions, and of the controllers extending it unless they declare their own
 * prefixes (a subclass's `@Prefix` replaces its parent's, it does not add to it):
 * - `route` is prepended to the routes of the HTTP actions (`'/users'` and `'/:id'` give `'/users/:id'`);
 * - `command` is prepended to the commands of the CLI actions, joined by ":" (`'user'` and `'get'` give `'user:get'`);
 * - `pattern` is merged into the patterns of the service actions (`{resource: 'user'}` and `{act: 'get'}` give
 *   `{resource: 'user', act: 'get'}`).
 *
 * A channel without its prefix keeps the addresses as declared; the scheduled actions have none. The prefixes apply when
 * the entrypoint registers the controller, and the prefixed actions are named after the registered controller, so that
 * the controllers sharing a parent have distinct actions. Several `@Prefix` on a class merge their options.
 * @param options The prefixes: `route`, `command` and `pattern`, each optional; the packages of other channels add
 * their own.
 * @returns The class decorator.
 * @throws {InvalidValueException} When the class is declared, if the options are invalid.
 * @throws {InvalidPrefixException} When the entrypoint initializes, if the pattern prefix sets a key that the pattern
 * of an action sets to another value.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {CLIAction, GET, Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 *
 * class UserIdDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public id!: string
 * }
 *
 * @Prefix({route: '/users', command: 'user', pattern: {resource: 'user'}})
 * class UserController extends Controller {
 *     //GET /users/:id, the command "user:get <id>" and the message {resource: 'user', act: 'get', id: …}
 *     @GET('/:id', UserIdDTO)
 *     @CLIAction('get <id>', UserIdDTO)
 *     @ServiceAction({act: 'get'}, UserIdDTO)
 *     public async get(input: UserIdDTO): Promise<{ id: string }> {
 *         return {id: input.id}
 *     }
 * }
 * ```
 */
export function Prefix<ClassConstructor extends typeof Controller>(options: PrefixOptions): (target: ClassConstructor) => void {
    return (target: ClassConstructor): void => SetPrefix(target, options)
}
