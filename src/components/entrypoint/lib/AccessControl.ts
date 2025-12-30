import {BaseObject} from '../../../lib/base/BaseObject.js'
import {
    BaseActionInfo,
    CLIActionInfo,
    CLIContext, ContextType,
    HTTPActionInfo,
    HTTPContext,
    ServiceActionInfo,
    ServiceContext
} from '../Entrypoint.js'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {Exception} from '../../../lib/base/abstracts/Exception.js'
import {AccessDenyException} from '../exceptions/AccessDenyException.js'
import {Container} from '../../../lib/core/Container.js'
import {ActionDetails} from '../../../lib/base/internal/ControllerEntrypoint.js'
import {AccessControlRule, AccessControlRuleHandler} from './AccessControlRule.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {DTO} from '../../../lib/core/DTO.js'
import {FunctionSchema} from '../../../lib/validation/interfaces/FunctionSchema.js'
import {As} from '../../../lib/helpers/As.js'

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

    protected readonly accessControlRuleConstructorDTO: FunctionSchema<typeof AccessControlRule> = DTO.Class(AccessControlRule)

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
            if (DTO.isValid(rule, this.accessControlRuleConstructorDTO)) {
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
    public static async run(rules: IBaseObjectConstructor<AccessControlRule>[], runtimeContainer: Container, context: CLIContext | HTTPContext | ServiceContext, input: Record<string, any>, details: ActionDetails, getActionsCallback: (type: ContextType) => BaseActionInfo[]): Promise<[boolean, Error | Exception]> {
        const actions: BaseActionInfo[] = getActionsCallback(context.type)
        let allowed: boolean = !details.acl
        let exception: Error | Exception = new AccessDenyException()
        if (!allowed) {
            // await runtimeContainer.set(this, {
            await runtimeContainer.build(this, {
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
            // await runtimeContainer.set(this, {
            await runtimeContainer.build(this, {
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
            exception
        ]
    }
}