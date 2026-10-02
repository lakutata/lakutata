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
import {ActionDetails} from './ControllerEntrypoint.js'
import {AccessControlRule, AccessControlRuleHandler} from './AccessControlRule.js'
import {As, IsSubclassOf} from '@lakutata/utils'

export class AccessControl extends BaseObject {

    @Configurable()
    protected readonly runtimeContainer: Container

    @Configurable()
    protected readonly actions: HTTPActionInfo[] | ServiceActionInfo[] | CLIActionInfo[]

    @Configurable()
    protected readonly target: HTTPActionInfo | ServiceActionInfo | CLIActionInfo

    @Configurable()
    protected readonly context: CLIContext | HTTPContext | ServiceContext

    @Configurable()
    protected readonly input: Record<string, any>

    @Configurable()
    protected readonly allowCallback: () => void

    @Configurable()
    protected readonly denyCallback: (error?: Error | Exception) => void

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
     * Initializer
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
     * Match rules
     * @protected
     */
    protected async match(): Promise<boolean> {
        for (const rule of this.rules) {
            if (IsSubclassOf(rule, AccessControlRule)) {
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
     * Run access control and return result
     * @param rules
     * @param runtimeContainer
     * @param context
     * @param input
     * @param details
     * @param getActionsCallback
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