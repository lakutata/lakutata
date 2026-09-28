import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {Expect} from '@lakutata/core/decorator/dto'
import {DTO} from '@lakutata/core'

export class ScheduleContext<T extends Record<string, any> = {}> extends BaseContext<T> {
    @Expect(DTO.String().valid(ContextType.SCHEDULE).default(ContextType.SCHEDULE))
    public readonly type: ContextType

    /**
     * The schedule of the action ("every 30s", "cron 0 * * * *")
     */
    @Expect(DTO.String().required())
    public readonly schedule: string

    /**
     * The time the run was planned for
     */
    @Expect(DTO.Date().required())
    public readonly scheduledAt: Date

    /**
     * The number of the run, from 1
     */
    @Expect(DTO.Number().integer().min(1).required())
    public readonly run: number

    constructor(params: ContextParams<{
        readonly schedule: string
        readonly scheduledAt: Date
        readonly run: number
        readonly data: Record<string, any>
    }>) {
        super(params)
    }
}
