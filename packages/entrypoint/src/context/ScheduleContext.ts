import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {Expect} from '@lakutata/core/decorator/dto'
import {DTO} from '@lakutata/core'
import {type ScheduleContextParams} from '../types/ScheduleContextParams.js'

/**
 * The context of a run of a scheduled action (`ScheduleEntrypoint`): `this.context` of a controller action declared
 * with `@Schedule`, when the schedule runs it. Its `data` is an empty object.
 * @example
 * ```typescript
 * import {Controller, ScheduleContext} from 'lakutata/com/entrypoint'
 * import {Schedule} from 'lakutata/decorator/ctrl'
 *
 * class ReportController extends Controller {
 *     //Every hour: logs "run 1 of every 1h, planned at …", then "run 2…"
 *     @Schedule('1h')
 *     public async hourly(): Promise<void> {
 *         if (!(this.context instanceof ScheduleContext)) return
 *         const delay: number = Date.now() - this.context.scheduledAt.getTime()
 *         console.log(`run ${this.context.run} of ${this.context.schedule}, planned at ${this.context.scheduledAt.toISOString()} (${delay}ms late)`)
 *     }
 * }
 * ```
 */
export class ScheduleContext<T extends Record<string, any> = {}> extends BaseContext<T> {
    /**
     * Always `ContextType.SCHEDULE`.
     */
    @Expect(DTO.String().valid(ContextType.SCHEDULE).default(ContextType.SCHEDULE))
    public readonly type: ContextType

    /**
     * The schedule of the action, as a text: `'every '` and the interval as declared (`'every 30s'`, `'every 500ms'` for a
     * number), or `'cron '` and the expression (`'cron 0 * * * *'`).
     */
    @Expect(DTO.String().required())
    public readonly schedule: string

    /**
     * The time the run was planned for; the run starts at it or a little later (the time of the launch for the
     * `immediate` run).
     */
    @Expect(DTO.Date().required())
    public readonly scheduledAt: Date

    /**
     * The number of the run in this process, from 1, counting the runs started (not the skipped ones).
     */
    @Expect(DTO.Number().integer().min(1).required())
    public readonly run: number

    /**
     * Create the context of a scheduled run, validating its properties.
     * @param params The schedule, the planned time, the run number and the data of the run.
     * @throws {InvalidValueException} When a property is invalid or a required one is missing.
     */
    constructor(params: ContextParams<ScheduleContextParams>) {
        super(params)
    }
}
