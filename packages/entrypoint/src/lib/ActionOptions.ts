import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {AccessControlRuleHandler} from './AccessControlRule.js'
import {BaseContext} from '../context/BaseContext.js'
import type {MiddlewareDefinition} from './Middleware.js'

export class ActionOptions<T extends BaseContext<Record<string, any>>> extends DTO {
    /**
     * Whether enable access control for this action
     */
    @Expect(DTO.Boolean().optional().default(false))
    public acl?: boolean

    /**
     * Action name
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public name?: string

    /**
     * Action description
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public description?: string

    /**
     * Action group names
     */
    @Expect(DTO.Array(DTO.String()).optional().default([]))
    public groups?: string[]

    /**
     * Action rule callback
     */
    @Expect(DTO.Function().optional())
    public rule?: AccessControlRuleHandler<T>

    /**
     * Action middlewares (run before the ones added to the action method by @UseMiddlewares)
     */
    @Expect(DTO.Array(DTO.Function()).optional().default([]))
    public middlewares?: MiddlewareDefinition[]
}

