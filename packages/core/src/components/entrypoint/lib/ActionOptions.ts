import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'
import type {AccessControlRuleHandler} from './AccessControlRule.js'
import {BaseContext} from '../../../lib/base/Context.js'

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
}

