/**
 * The parameters creating a `ScheduleContext`, given by the schedule adapter.
 */
export type ScheduleContextParams = {
    /**
     * The schedule of the action, as a text (`'every 30s'`, `'cron 0 * * * *'`).
     */
    readonly schedule: string
    /**
     * The time the run was planned for.
     */
    readonly scheduledAt: Date
    /**
     * The number of the run, from 1.
     */
    readonly run: number
    /**
     * The input of the run: an empty object for the schedule adapter.
     */
    readonly data: Record<string, any>
}
