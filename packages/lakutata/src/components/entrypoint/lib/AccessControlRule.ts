import {BaseObject} from '../../../lib/base/BaseObject.js'
import type {ActionPattern} from '../../../types/ActionPattern.js'
import {BaseContext, ContextType} from '../../../lib/base/Context.js'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {CLIActionInfo, HTTPActionInfo, ServiceActionInfo} from '../Entrypoint.js'

export type AccessControlRuleHandler<T extends BaseContext<Record<string, any>>> = (
    context: T,
    input?: ActionPattern<any>
) => Promise<boolean>

export abstract class AccessControlRule<T extends BaseContext<Record<string, any>> = BaseContext<Record<string, any>>> extends BaseObject {

    @Configurable()
    protected readonly context: T

    @Configurable()
    protected readonly input: ActionPattern<any>

    @Configurable()
    protected readonly actions: HTTPActionInfo[] | ServiceActionInfo[] | CLIActionInfo[]

    @Configurable()
    protected readonly targetAction: HTTPActionInfo | ServiceActionInfo | CLIActionInfo

    public abstract get supportContextTypes(): ContextType[]

    /**
     * Rule handler
     */
    public abstract rule(): Promise<boolean>
}