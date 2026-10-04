import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {AccessControlRuleHandler} from './AccessControlRule.js'
import {BaseContext} from '../context/BaseContext.js'
import type {MiddlewareDefinition} from './Middleware.js'

/**
 * The options of a controller action, the last argument of the action decorators (`@GET`, `@CLIAction`,
 * `@ServiceAction`, `@Schedule`…).
 * @example
 * ```typescript
 * import {Controller, type HTTPContext} from 'lakutata/com/entrypoint'
 * import {type ActionOptions} from '@lakutata/entrypoint/channel'
 * import {GET} from 'lakutata/decorator/ctrl'
 *
 * //Only the requests carrying the admin token reach the action
 * const adminOnly: ActionOptions<HTTPContext> = {
 *     acl: true,
 *     name: 'listUsers',
 *     description: 'List the users',
 *     groups: ['admin'],
 *     rule: async (context: HTTPContext): Promise<boolean> => context.request.headers.authorization === 'Bearer admin'
 * }
 *
 * class UserController extends Controller {
 *     @GET('/users', adminOnly)
 *     public async list(): Promise<string[]> {
 *         return []
 *     }
 * }
 * ```
 */
export class ActionOptions<T extends BaseContext<Record<string, any>>> extends DTO {
    /**
     * Whether the entrypoint's access control rules are checked for the action; a request they deny fails with an
     * `AccessDeniedException`. With no rule (or none supporting the request's context type), the access is
     * allowed.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public acl?: boolean

    /**
     * The action's name, unique within its channel among the controller methods (the addresses of one method may
     * share it): `ControllerClass:method` when empty.
     * @default ''
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public name?: string

    /**
     * The action's description, listed with the action.
     * @default ''
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public description?: string

    /**
     * The ids of the action's groups; for HTTP, CLI and service actions each id must be a key of the entrypoint's
     * action groups option (`httpActionGroups`…), or the entrypoint fails to initialize.
     * @default []
     */
    @Expect(DTO.Array(DTO.String()).optional().default([]))
    public groups?: string[]

    /**
     * The action's own access rule, checked after the entrypoint's rules when `acl` is on, and alone when it is off:
     * resolving `false` denies the request (`AccessDeniedException`), throwing denies it with the thrown error.
     */
    @Expect(DTO.Function().optional())
    public rule?: AccessControlRuleHandler<T>

    /**
     * The action's middlewares, run after the ones of the controller class and before the ones added to the method
     * by `@UseMiddlewares`.
     * @default []
     */
    @Expect(DTO.Array(DTO.Function()).optional().default([]))
    public middlewares?: MiddlewareDefinition[]
}

