import {type CronOptions} from '../../../types/CronOptions.js'

/**
 * Derived from lib of cron-validator 1.4.0 (MIT, see THIRD_PARTY_NOTICES.md): the validation of the cron expressions
 */

/**
 * The options of the validation, all given
 */
type Options = Required<CronOptions>

const DEFAULT_OPTIONS: Options = {
    alias: false,
    seconds: false,
    allowBlankDay: false,
    allowSevenAsSunday: false,
    allowNthWeekdayOfMonth: false
}

const MONTH_ALIASES: Record<string, string> = {
    jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6', jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12'
}

const WEEKDAY_ALIASES: Record<string, string> = {
    sun: '0', mon: '1', tue: '2', wed: '3', thu: '4', fri: '5', sat: '6'
}

/**
 * The number of a field: only digits (parseInt() would read "1*" as 1)
 * @param value
 */
function safeParseInt(value: string): number {
    return /^\d+$/.test(value) ? Number(value) : NaN
}

function isInRange(value: number, start: number, stop: number): boolean {
    return value >= start && value <= stop
}

/**
 * A value, a range of values or a wildcard
 * @param value
 * @param start
 * @param stop
 */
function isValidRange(value: string, start: number, stop: number): boolean {
    const sides: string[] = value.split('-')
    switch (sides.length) {
        case 1:
            return value === '*' || isInRange(safeParseInt(value), start, stop)
        case 2: {
            const [small, big] = sides.map(safeParseInt)
            return small <= big && isInRange(small, start, stop) && isInRange(big, start, stop)
        }
        default:
            return false
    }
}

function isValidStep(value: string | undefined): boolean {
    return value === undefined || (value.search(/[^\d]/) === -1 && safeParseInt(value) > 0)
}

/**
 * A list of values, ranges or wildcards with their steps
 * @param value
 * @param start
 * @param stop
 */
function validateForRange(value: string, start: number, stop: number): boolean {
    if (value.search(/[^\d-,\/*]/) !== -1) return false
    return value.split(',').every((condition: string): boolean => {
        const splits: string[] = condition.split('/')
        //"*/" has no step, "*/*/*" several
        if (condition.trim().endsWith('/') || splits.length > 2) return false
        return isValidRange(splits[0], start, stop) && isValidStep(splits[1])
    })
}

/**
 * The names replaced by their numbers
 * @param value
 * @param aliases
 */
function unalias(value: string, aliases: Record<string, string>): string {
    return value.toLowerCase().replace(/[a-z]{3}/g, (match: string): string => aliases[match] ?? match)
}

function hasValidDays(days: string, allowBlankDay: boolean): boolean {
    return (allowBlankDay && days === '?') || validateForRange(days, 1, 31)
}

function hasValidMonths(months: string, alias: boolean): boolean {
    //A name is not a step
    if (months.search(/\/[a-zA-Z]/) !== -1) return false
    //An unknown name is left, the validation of the numbers rejects it
    return validateForRange(alias ? unalias(months, MONTH_ALIASES) : months, 1, 12)
}

function hasValidWeekdays(weekdays: string, options: Options): boolean {
    if (weekdays === '?') return options.allowBlankDay
    //A name is not a step
    if (weekdays.search(/\/[a-zA-Z]/) !== -1) return false
    const remapped: string = options.alias ? unalias(weekdays, WEEKDAY_ALIASES) : weekdays
    const maxWeekday: number = options.allowSevenAsSunday ? 7 : 6
    const splitByHash: string[] = remapped.split('#')
    //The nth weekday of the month (Quartz): weekday#occurrence
    if (options.allowNthWeekdayOfMonth && splitByHash.length >= 2) {
        const [weekday, occurrence, ...leftOvers] = splitByHash
        if (leftOvers.length) return false
        return isInRange(safeParseInt(occurrence), 1, 5) && isInRange(safeParseInt(weekday), 0, maxWeekday)
    }
    return validateForRange(remapped, 0, maxWeekday)
}

/**
 * Whether a cron expression is valid: five fields (minutes, hours, days, months, weekdays), or six with the seconds
 * first when they are allowed
 * @param cron
 * @param partialOptions
 */
export function isValidCron(cron: string, partialOptions?: CronOptions): boolean {
    const options: Options = {...DEFAULT_OPTIONS, ...partialOptions}
    const splits: string[] = cron.trim().split(/\s+/)
    if (splits.length > (options.seconds ? 6 : 5) || splits.length < 5) return false
    const checks: boolean[] = []
    if (splits.length === 6) {
        const seconds: string = splits.shift()!
        if (seconds) checks.push(validateForRange(seconds, 0, 59))
    }
    const [minutes, hours, days, months, weekdays] = splits
    checks.push(validateForRange(minutes, 0, 59))
    checks.push(validateForRange(hours, 0, 23))
    checks.push(hasValidDays(days, options.allowBlankDay))
    checks.push(hasValidMonths(months, options.alias))
    checks.push(hasValidWeekdays(weekdays, options))
    //Not both days blank
    checks.push(!(options.allowBlankDay && days === '?' && weekdays === '?'))
    return checks.every(Boolean)
}
