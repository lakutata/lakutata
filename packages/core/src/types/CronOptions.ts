/**
 * The options of the validation of the cron expressions (DTO.Cron())
 */
export type CronOptions = {
    /**
     * Allow the names of the months and of the days of the week (JAN, MON-FRI)
     */
    alias?: boolean
    /**
     * Allow a field of the seconds (six fields)
     */
    seconds?: boolean
    /**
     * Allow "?" in the fields of the day of the month and of the day of the week
     */
    allowBlankDay?: boolean
    /**
     * Allow 7 as Sunday in the field of the day of the week
     */
    allowSevenAsSunday?: boolean
}
