import {BaseObject, type ActionPattern} from '@lakutata/core'
import {BaseContext, ContextType} from '../context/BaseContext.js'
import {Configurable} from '@lakutata/core/decorator/di'
import {CLIActionInfo, HTTPActionInfo, ServiceActionInfo} from '../Entrypoint.js'
import type {ActionInfo} from './ControllerEntrypoint.js'

/**
 * An action's own access rule (the `rule` action option): resolve `true` to allow the request, `false` to deny it with
 * an `AccessDeniedException`; a thrown error denies it with that error.
 * @param context The request's context.
 * @param input The action's validated input.
 * @returns Whether the request is allowed.
 */
export type AccessControlRuleHandler<T extends BaseContext<Record<string, any>>> = (
    context: T,
    input?: ActionPattern<any>
) => Promise<boolean>

/**
 * An access control rule, checked for the actions declared with `acl: true`: give the rule classes to the
 * entrypoint's `rules` option. For each request to such an action, every rule supporting the request's context type
 * is created in the request's container (its dependencies injected) and its {@link AccessControlRule.rule} called, in
 * the order of the option; the first one resolving `false` denies the request with an `AccessDeniedException`, the
 * first one throwing denies it with its error. A request no rule denies is allowed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {AccessControlRule, buildEntrypoints, ContextType, Controller, type HTTPContext} from 'lakutata/com/entrypoint'
 * import {DELETE} from 'lakutata/decorator/ctrl'
 *
 * //Only the requests of an administrator reach the actions of the "admin" group
 * class AdminRule extends AccessControlRule<HTTPContext> {
 *     public get supportContextTypes(): ContextType[] {
 *         return [ContextType.HTTP]
 *     }
 *
 *     public async rule(): Promise<boolean> {
 *         if (!this.targetAction.groups.includes('admin')) return true
 *         return this.context.request.headers['x-role'] === 'admin'
 *     }
 * }
 *
 * class UserController extends Controller {
 *     @DELETE('/users/:id', {acl: true, groups: ['admin']})
 *     public async remove(input: {id: string}): Promise<void> {
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'admin.app',
 *     name: 'Admin',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [UserController],
 *             rules: [AdminRule],
 *             httpActionGroups: {admin: 'Administration'}
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export abstract class AccessControlRule<T extends BaseContext<Record<string, any>> = BaseContext<Record<string, any>>> extends BaseObject {

    /**
     * The request's context.
     * @protected
     */
    @Configurable()
    protected readonly context: T

    /**
     * The action's validated input.
     * @protected
     */
    @Configurable()
    protected readonly input: ActionPattern<any>

    /**
     * The descriptions of every action of the request's channel (to check the permissions an action requires against
     * the others).
     * @protected
     */
    @Configurable()
    protected readonly actions: HTTPActionInfo[] | ServiceActionInfo[] | CLIActionInfo[]

    /**
     * The requested action: its `id`, `name`, `description`, `groups`, `acl`, `rule` and `action`
     * (`ControllerClass:method`). Its channel's fields (`route`, `command`, `pattern`), `controller`, `method` and
     * `jsonSchema` are in {@link AccessControlRule.actions}, found by `id`.
     * @protected
     */
    @Configurable()
    protected readonly targetAction: ActionInfo

    /**
     * The context types of the requests the rule checks (`ContextType.HTTP`…, or the context type of another channel);
     * for the other requests the rule is created but its {@link AccessControlRule.rule} is not called.
     */
    public abstract get supportContextTypes(): ContextType[]

    /**
     * Check the request.
     * @returns `true` to let the next rules check the request, `false` to deny it with an `AccessDeniedException`.
     * @throws {Error} Any error, to deny the request with it.
     */
    public abstract rule(): Promise<boolean>
}