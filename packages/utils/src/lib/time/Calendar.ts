/**
 * The calendar computations of the wall clock (proleptic Gregorian calendar). A wall clock time is represented as the
 * milliseconds of the same fields in UTC ("local milliseconds"), read with the UTC methods of Date.
 */

/**
 * The first day of the week and the day of January which is always in the first week, of the weeks of the locale
 * (English: weeks start on Sunday, and contain January 1st) and of the ISO weeks (Monday, January 4th)
 */
export interface WeekRules {
    dow: number
    doy: number
}

export const LOCALE_WEEK: WeekRules = {dow: 0, doy: 6}

export const ISO_WEEK: WeekRules = {dow: 1, doy: 4}

/**
 * Whether a year is a leap year
 * @param year
 */
export function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * The number of days of a year
 * @param year
 */
export function daysInYear(year: number): number {
    return isLeapYear(year) ? 366 : 365
}

/**
 * The number of days of a month (the month may be out of 0 to 11: it bubbles up to the year)
 * @param year
 * @param month
 */
export function daysInMonth(year: number, month: number): number {
    if (isNaN(year) || isNaN(month)) return NaN
    const monthOfYear: number = ((month % 12) + 12) % 12
    year += (month - monthOfYear) / 12
    return monthOfYear === 1 ? (isLeapYear(year) ? 29 : 28) : 31 - ((monthOfYear % 7) % 2)
}

/**
 * The local milliseconds of fields (the fields may overflow: they bubble up)
 * @param year
 * @param month
 * @param date
 * @param hours
 * @param minutes
 * @param seconds
 * @param milliseconds
 */
export function localMilliseconds(year: number, month: number, date: number = 1, hours: number = 0, minutes: number = 0, seconds: number = 0, milliseconds: number = 0): number {
    const local: Date = new Date(0)
    local.setUTCFullYear(year, month, date)
    local.setUTCHours(hours, minutes, seconds, milliseconds)
    return local.getTime()
}

/**
 * The day of the year (1 to 366) of local milliseconds
 * @param local
 */
export function dayOfYearOf(local: number): number {
    const date: Date = new Date(local)
    return Math.round((localMilliseconds(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - localMilliseconds(date.getUTCFullYear(), 0, 1)) / 864e5) + 1
}

/**
 * The offset of the first week of a year, from January 1st, in days
 * @param year
 * @param rules
 */
function firstWeekOffset(year: number, rules: WeekRules): number {
    //The day of January always in the first week
    const firstWeekDay: number = 7 + rules.dow - rules.doy
    const firstWeekDayOfWeek: number = (7 + new Date(localMilliseconds(year, 0, firstWeekDay)).getUTCDay() - rules.dow) % 7
    return -firstWeekDayOfWeek + firstWeekDay - 1
}

/**
 * The number of weeks of a week year
 * @param year
 * @param rules
 */
export function weeksInYear(year: number, rules: WeekRules): number {
    return (daysInYear(year) - firstWeekOffset(year, rules) + firstWeekOffset(year + 1, rules)) / 7
}

/**
 * The week and the week year of local milliseconds
 * @param local
 * @param rules
 */
export function weekOfYear(local: number, rules: WeekRules): { week: number, year: number } {
    const year: number = new Date(local).getUTCFullYear()
    const week: number = Math.floor((dayOfYearOf(local) - firstWeekOffset(year, rules) - 1) / 7) + 1
    if (week < 1) return {week: week + weeksInYear(year - 1, rules), year: year - 1}
    if (week > weeksInYear(year, rules)) return {week: week - weeksInYear(year, rules), year: year + 1}
    return {week, year}
}

/**
 * The year and the day of the year of a week of a week year, and a day of the week
 * @param year
 * @param week
 * @param weekday the day of the week (0 is Sunday)
 * @param rules
 */
export function dayOfYearFromWeeks(year: number, week: number, weekday: number, rules: WeekRules): { year: number, dayOfYear: number } {
    const localWeekday: number = (7 + weekday - rules.dow) % 7
    const dayOfYear: number = 1 + 7 * (week - 1) + localWeekday + firstWeekOffset(year, rules)
    if (dayOfYear <= 0) return {year: year - 1, dayOfYear: daysInYear(year - 1) + dayOfYear}
    if (dayOfYear > daysInYear(year)) return {year: year + 1, dayOfYear: dayOfYear - daysInYear(year)}
    return {year, dayOfYear}
}
