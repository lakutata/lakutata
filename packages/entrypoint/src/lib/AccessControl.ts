import {BaseObject, Exception, Container, IBaseObjectConstructor, DTO, FunctionSchema} from '@lakutata/core'
import {
    BaseActionInfo,
    CLIActionInfo,
    CLIContext, ContextType,
    HTTPActionInfo,
    HTTPContext,
    ServiceActionInfo,
    ServiceContext
} from '../Entrypoint.js'
import {Configurable} from '@lakutata/core/decorator/di'
import {AccessDeniedException} from '../exceptions/AccessDeniedException.js'
import {ActionDetails, type ActionInfo} from './ControllerEntrypoint.js'
import {AccessControlRule, AccessControlRuleHandler} from './AccessControlRule.js'
import {As, isSubclassOf} from '@lakutata/utils'

/**
 * The access control of the entrypoint's actions: it checks a request to an action declared with `acl: true` against
 * the entrypoint's rules and the action's own `rule`, or against the action's `rule` alone when `acl` is off. The
 * entrypoint calls {@link AccessControl.run} for each request, after the input validation and before the action; a
 * subclass of the entrypoint may replace it with a subclass (its protected `accessControl` property), for example to
 * audit the decisions.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {AccessControl, Controller, Entrypoint} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 *
 * //Log every access decision
 * class AuditedAccessControl extends AccessControl {
 *     protected async match(): Promise<boolean> {
 *         const allowed: boolean = await super.match()
 *         console.log(`${this.target.name}: ${allowed ? 'allowed' : 'denied'}`)
 *         return allowed
 *     }
 * }
 *
 * class AuditedEntrypoint extends Entrypoint {
 *     protected readonly accessControl: typeof AccessControl = AuditedAccessControl
 * }
 *
 * class ReportController extends Controller {
 *     @GET('/reports', {acl: true, rule: async (): Promise<boolean> => true})
 *     public async list(): Promise<string[]> {
 *         return []
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'report.app',
 *     name: 'Report',
 *     components: {
 *         entrypoint: {class: AuditedEntrypoint, controllers: [ReportController]}
 *     }
 * }))
 * ```
 */
export class AccessControl extends BaseObject {

    /**
     * The request's container, where the rules are created.
     * @protected
     */
    @Configurable()
    protected readonly runtimeContainer: Container

    /**
     * The descriptions of every action of the request's channel.
     * @protected
     */
    @Configurable()
    protected readonly actions: HTTPActionInfo[] | ServiceActionInfo[] | CLIActionInfo[]

    /**
     * The requested action: its identity and options (without the channel's fields).
     * @protected
     */
    @Configurable()
    protected readonly target: ActionInfo

    /**
     * The request's context.
     * @protected
     */
    @Configurable()
    protected readonly context: CLIContext | HTTPContext | ServiceContext

    /**
     * The action's validated input.
     * @protected
     */
    @Configurable()
    protected readonly input: Record<string, any>

    /**
     * Called when the rules allow the request.
     * @protected
     */
    @Configurable()
    protected readonly allowCallback: () => void

    /**
     * Called when a rule denies the request, with the error a rule threw (none when a rule resolved `false`).
     * @protected
     */
    @Configurable()
    protected readonly denyCallback: (error?: Error | Exception) => void

    /**
     * The rules to check, in order: rule classes and rule functions.
     * @protected
     */
    @Configurable()
    protected readonly rules: (IBaseObjectConstructor<AccessControlRule> | AccessControlRuleHandler<any>)[]

    /**
     * Schema of access control rule constructors, built only when it is used
     * @protected
     */
    protected get accessControlRuleConstructorDTO(): FunctionSchema<typeof AccessControlRule> {
        return DTO.Class(AccessControlRule)
    }

    /**
     * Check the rules and call the allow or deny callback.
     * @protected
     */
    protected async init(): Promise<void> {
        try {
            const matchResult: boolean = await this.match()
            if (matchResult) return this.allowCallback()
            return this.denyCallback()
        } catch (e: any) {
            return this.denyCallback(e)
        }
    }

    /**
     * Check the rules in order: a rule class is created in the request's container and checked when it supports the
     * request's context type, a rule function is called with the context and the input.
     * @returns `false` as soon as a rule resolves `false`, `true` when none does (no rule included).
     * @throws {Error} The error a rule throws (the request is then denied with it).
     * @protected
     */
    protected async match(): Promise<boolean> {
        for (const rule of this.rules) {
            if (isSubclassOf(rule, AccessControlRule)) {
                const RuleObjectConstructor: IBaseObjectConstructor<AccessControlRule> = As<IBaseObjectConstructor<AccessControlRule>>(rule)
                const ruleObjectInstance: AccessControlRule = await this.runtimeContainer.build(RuleObjectConstructor, {
                    actions: this.actions,
                    targetAction: this.target,
                    context: this.context,
                    input: this.input
                })
                if (!ruleObjectInstance.supportContextTypes.includes(this.context.type)) continue
                if (!(await ruleObjectInstance.rule())) return false
            } else {
                const handler: AccessControlRuleHandler<any> = As<AccessControlRuleHandler<any>>(rule)
                if (!(await handler(this.context, this.input))) return false
            }
        }
        return true
    }

    /**
     * Check the access to an action: with `acl: true`, against the rules then the action's own `rule`; with `acl`
     * off, against the action's `rule` alone; without either, the request is allowed without check.
     * @param rules The entrypoint's rule classes.
     * @param runtimeContainer The request's container, where the access control and the rules are created.
     * @param context The request's context.
     * @param input The action's validated input.
     * @param details The requested action.
     * @param getActionsCallback Returns the descriptions of the actions of a context type's channel.
     * @returns Whether the request is allowed, and when it is not, the error to fail it with: the error a rule
     * threw, or an `AccessDeniedException`.
     */
    public static async run(rules: IBaseObjectConstructor<AccessControlRule>[], runtimeContainer: Container, context: CLIContext | HTTPContext | ServiceContext, input: Record<string, any>, details: ActionDetails, getActionsCallback: (type: ContextType | string) => BaseActionInfo[]): Promise<[boolean, Error | Exception | undefined]> {
        const actions: BaseActionInfo[] = getActionsCallback(context.type)
        let allowed: boolean = !details.acl
        //The exception is created only when access is denied (building it captures a stack trace)
        let exception: Error | Exception | undefined
        if (!allowed) {
            await runtimeContainer.set(this, {
            // await runtimeContainer.build(this, {
                rules: [...rules, details.rule].filter((rule: any): boolean => !!rule),
                runtimeContainer: runtimeContainer,
                actions: actions,
                context: context,
                input: input,
                target: details.getActionInfo(),
                allowCallback: () => {
                    allowed = true
                },
                denyCallback: (error?: Error | Exception) => {
                    allowed = false
                    exception = error ? error : exception
                }
            })
        } else if (details.rule) {
            await runtimeContainer.set(this, {
            // await runtimeContainer.build(this, {
                rules: [details.rule],
                runtimeContainer: runtimeContainer,
                actions: actions,
                context: context,
                input: input,
                target: details.getActionInfo(),
                allowCallback: () => {
                    allowed = true
                },
                denyCallback: (error?: Error | Exception) => {
                    allowed = false
                    exception = error ? error : exception
                }
            })
        }
        return [
            allowed,
            allowed ? undefined : (exception ? exception : new AccessDeniedException())
        ]
    }
}