/**
 * The parameters of the context of the scheduled runs (ScheduleContext)
 */
export type ScheduleContextParams = {
    readonly schedule: string
    readonly scheduledAt: Date
    readonly run: number
    readonly data: Record<string, any>
}
