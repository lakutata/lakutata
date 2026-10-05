import {assertZone, defaultZone, offsetAt, zoneAbbreviation, zoneLongName, supportedZoneNames} from './time/Zone.js'
import {
    dayOfYearOf,
    dayOfYearFromWeeks,
    daysInMonth,
    ISO_WEEK,
    isLeapYear,
    LOCALE_WEEK,
    localMilliseconds,
    weekOfYear,
    weeksInYear,
    type WeekRules
} from './time/Calendar.js'
import {DEFAULT_FORMAT, DEFAULT_UTC_FORMAT, type FormatContext, formatTime} from './time/Format.js'

/**
 * The units of time accepted by the `Time` methods, by their long name (`'day'`), plural (`'days'`) or short name
 * (`'d'`). The long and plural names are also accepted in any case (`'Days'`); the short names are case-sensitive:
 * `'M'` is the month and `'m'` the minute, `'D'` the day of the month (`'date'`) and `'d'` the day of the week
 * (`'day'`).
 */
export namespace UnitOfTime {
    /**
     * The units of every operation: year, month, week, day, hour, minute, second, millisecond.
     */
    export type Base = (
        'year' | 'years' | 'y' |
        'month' | 'months' | 'M' |
        'week' | 'weeks' | 'w' |
        'day' | 'days' | 'd' |
        'hour' | 'hours' | 'h' |
        'minute' | 'minutes' | 'm' |
        'second' | 'seconds' | 's' |
        'millisecond' | 'milliseconds' | 'ms'
        )

    /**
     * The quarter: three months.
     */
    export type _quarter = 'quarter' | 'quarters' | 'Q'

    /**
     * The ISO week: Monday to Sunday.
     */
    export type _isoWeek = 'isoWeek' | 'isoWeeks' | 'W'

    /**
     * The day of the month.
     */
    export type _date = 'date' | 'dates' | 'D'

    /**
     * The units of `add` and `subtract`.
     */
    export type DurationConstructor = Base | _quarter

    /**
     * The units of a duration.
     */
    export type DurationAs = Base

    /**
     * The units of `startOf`, `endOf` and the granularity of the comparisons (`isBefore`, `isSame`…); `null` is no unit
     * (the exact instant).
     */
    export type StartOf = Base | _quarter | _isoWeek | _date | null

    /**
     * The units of `diff`.
     */
    export type Diff = Base | _quarter

    /**
     * The units of the fields of a time.
     */
    export type MomentConstructor = Base | _date

    /**
     * The units of `get` and `set`: the base units, plus the quarter, the ISO week, the day of the month, the week year
     * (`'weekYear'`, `'gg'`) and the ISO week year (`'isoWeekYear'`, `'GG'`), the day of the year (`'dayOfYear'`,
     * `'DDD'`), and the days of the week (`'weekday'`, `'e'`: 0 is Sunday; `'isoWeekday'`, `'E'`: 1 is Monday).
     */
    export type All = Base | _quarter | _isoWeek | _date |
        'weekYear' | 'weekYears' | 'gg' |
        'isoWeekYear' | 'isoWeekYears' | 'GG' |
        'dayOfYear' | 'dayOfYears' | 'DDD' |
        'weekday' | 'weekdays' | 'e' |
        'isoWeekday' | 'isoWeekdays' | 'E'
}

/**
 * A time accepted by `new Time()` and the methods comparing times:
 * - `null` (or nothing): now;
 * - a `Time`: its instant and its time zone; a `Date`: its instant;
 * - a number: milliseconds since the Unix epoch (the string of an integer or a decimal number too, `'1700000000000'`);
 * - a string: a date as `Date` parses it. With `Z` or an offset (`'2024-03-01T07:30:00+08:00'`), or a zone name `Date`
 *   knows (`'GMT'`, `'EST'`), it is that instant; without one (`'2024-03-01'`, `'2024-03-01 07:30'`, `'March 1, 2024
 *   07:30'`), it is the wall clock in the time zone of the `Time` reading it: the default zone for `new Time()`, the
 *   instance's zone for its comparisons and `diff`;
 * - an array: the wall clock fields `[year, month, date, hours, minutes, seconds, milliseconds]`, in the same time zone
 *   as a string without offset, the month from 0 (January) to 11; the missing leading fields are the current ones
 *   (`[]` is today, `[undefined, 5]` June of this year), the missing trailing fields their smallest (`[2024]` is
 *   January 1st 2024 at midnight); a field out of its range (`[2023, 1, 29]`) gives an invalid time.
 *
 * A wall clock time read in a time zone which skips it (02:30 when the clocks jump from 02:00 to 03:00) moves forward by
 * the length of the gap (03:30); one which is repeated (the clocks turned back) is the earlier one.
 */
export type TimeInput = Time | Date | string | number | (number | string)[] | null

/**
 * The wall clock fields of a time in its time zone (`Time.toObject()`).
 */
export type TimeObject = {
    /**
     * The year (`2024`).
     */
    years: number
    /**
     * The month, from 0 (January) to 11 (December).
     */
    months: number
    /**
     * The day of the month, from 1 to 31.
     */
    date: number
    /**
     * The hours, from 0 to 23.
     */
    hours: number
    /**
     * The minutes, from 0 to 59.
     */
    minutes: number
    /**
     * The seconds, from 0 to 59.
     */
    seconds: number
    /**
     * The milliseconds, from 0 to 999.
     */
    milliseconds: number
}

/**
 * The normalized units
 */
type Unit = 'year' | 'quarter' | 'month' | 'week' | 'isoWeek' | 'day' | 'date' | 'hour' | 'minute' | 'second' | 'millisecond' |
    'dayOfYear' | 'weekday' | 'isoWeekday' | 'weekYear' | 'isoWeekYear'

/**
 * The units by alias (the singular, plural and short names; the names are also matched in lower case)
 */
const UNIT_ALIASES: Map<string, Unit> = new Map()
for (const [unit, short] of [
    ['year', 'y'], ['quarter', 'Q'], ['month', 'M'], ['week', 'w'], ['isoWeek', 'W'], ['day', 'd'], ['date', 'D'], ['hour', 'h'],
    ['minute', 'm'], ['second', 's'], ['millisecond', 'ms'], ['dayOfYear', 'DDD'], ['weekday', 'e'], ['isoWeekday', 'E'],
    ['weekYear', 'gg'], ['isoWeekYear', 'GG']
] as [Unit, string][]) {
    UNIT_ALIASES.set(unit.toLowerCase(), unit)
    UNIT_ALIASES.set(`${unit.toLowerCase()}s`, unit)
    UNIT_ALIASES.set(short, unit)
}

/**
 * The unit of an alias (undefined: not a unit)
 * @param unit
 */
function normalizeUnit(unit: string | null | undefined): Unit | undefined {
    if (typeof unit !== 'string') return undefined
    return UNIT_ALIASES.get(unit) || UNIT_ALIASES.get(unit.toLowerCase())
}

/**
 * Rounds half away from zero
 * @param value
 */
function absRound(value: number): number {
    return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Rounds toward zero
 * @param value
 */
function absFloor(value: number): number {
    return value < 0 ? (Math.ceil(value) || 0) : Math.floor(value)
}

/**
 * The instant of wall clock fields (local milliseconds) in a time zone. A wall clock time repeated by a transition (the
 * clocks turned back) keeps the preferred offset when it has it, else is the earlier one; a wall clock time skipped by a
 * transition (the clocks turned forward) moves forward by the length of the gap, as the 'compatible' disambiguation of
 * Temporal and moment do, whatever the time it comes from
 * @param zone
 * @param local
 * @param preferred the offset to keep (minutes), NaN for none
 */
function localToInstant(zone: string, local: number, preferred: number = NaN): number {
    if (isNaN(local)) return NaN
    if (!isNaN(preferred) && offsetAt(zone, local - preferred * 60000) === preferred) return local - preferred * 60000
    //The offsets of the day before and of the day after: the ones around a transition
    const before: number = offsetAt(zone, local - 864e5)
    const after: number = offsetAt(zone, local + 864e5)
    let earliest: number = NaN
    for (const offset of before === after ? [before] : [before, after]) {
        const instant: number = local - offset * 60000
        if (offsetAt(zone, instant) === offset && (isNaN(earliest) || instant < earliest)) earliest = instant
    }
    //In a gap, the offset before it: the wall clock moves forward by its length
    return isNaN(earliest) ? local - before * 60000 : earliest
}

/**
 * An ISO 8601 date, or date and time, without offset
 */
const ISO_LOCAL: RegExp = /^\s*([+-]\d{6}|\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?)?\s*$/i

/**
 * A zone designator after a time (Z, an offset), or a zone name Date knows
 */
const ZONE_DESIGNATOR: RegExp = /\d:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:[AP]M\s*)?(?:Z|[+-]\d{2}(?::?\d{2})?)\b|\b(?:GMT|UTC|UT|Z|[ECMP][SD]T)\b/i

/**
 * The instant of a time string: a timestamp in milliseconds, or a date string, read in a time zone without offset
 * @param input
 * @param zone
 * @throws RangeError when the string is not a time
 */
function parseTimeString(input: string, zone: string): number {
    if (/^[+-]?\d+(\.\d+)?$/.test(input)) return new Date(parseFloat(input)).getTime()
    const parsed: Date = new Date(input)
    if (/^\s*$/.test(input) || isNaN(parsed.getTime())) throw new RangeError(`Invalid time value: "${input}"`)
    const iso: RegExpExecArray | null = ISO_LOCAL.exec(input)
    if (iso) {
        //Date reads a date alone in UTC, a date and time in the process's time zone: both in the zone instead
        const [, year, month, date, hours, minutes, seconds, fraction] = iso
        const milliseconds: number = fraction ? parseInt(fraction.padEnd(3, '0').slice(0, 3), 10) : 0
        return localToInstant(zone, localMilliseconds(parseInt(year, 10), parseInt(month, 10) - 1, date ? parseInt(date, 10) : 1, hours ? parseInt(hours, 10) : 0, minutes ? parseInt(minutes, 10) : 0, seconds ? parseInt(seconds, 10) : 0, milliseconds))
    }
    if (ZONE_DESIGNATOR.test(input)) return parsed.getTime()
    //Another format read by Date in the process's time zone: its wall clock in the zone instead
    return localToInstant(zone, localMilliseconds(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes(), parsed.getSeconds(), parsed.getMilliseconds()))
}

/**
 * The instant of wall clock fields in a time zone ([year, month, date, hours, minutes, seconds, milliseconds]: the
 * leading missing fields are the current ones, the other missing fields are the smallest); fields out of their range
 * make an invalid time
 * @param input
 * @param zone
 */
function arrayToTime(input: (number | string)[], zone: string): number {
    const fields: (number | undefined)[] = input.slice(0, 7).map((field: number | string | undefined | null): number | undefined => {
        if (field === undefined || field === null) return undefined
        return typeof field === 'number' ? field : parseInt(field, 10)
    })
    const nowInstant: number = Date.now()
    const now: Date = new Date(nowInstant + offsetAt(zone, nowInstant) * 60000)
    const current: number[] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()]
    let i: number = 0
    for (; i < 3 && fields[i] === undefined; i++) fields[i] = current[i]
    for (; i < 7; i++) if (fields[i] === undefined) fields[i] = i === 2 ? 1 : 0
    const [year, month, date, hours, minutes, seconds, milliseconds] = fields as number[]
    const overflow: boolean = month < 0 || month > 11 ||
        date < 1 || date > daysInMonth(year, month) ||
        hours < 0 || hours > 24 || (hours === 24 && (minutes !== 0 || seconds !== 0 || milliseconds !== 0)) ||
        minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59 || milliseconds < 0 || milliseconds > 999
    if (overflow) return NaN
    return localToInstant(zone, localMilliseconds(year, month, date, hours, minutes, seconds, milliseconds))
}

/**
 * The instant of a time input, its strings without offset and its arrays read in a time zone
 * @param inp
 * @param zone
 */
function inputToInstant(inp: TimeInput | undefined, zone: string): number {
    if (inp === undefined || inp === null) return Date.now()
    if (inp instanceof Date) return inp.getTime()
    if (typeof inp === 'number') return inp
    if (typeof inp === 'string') return parseTimeString(inp, zone)
    if (Array.isArray(inp)) return arrayToTime(inp, zone)
    return NaN
}

/**
 * A date and time in a time zone, with the API of the moment library: reading and setting the wall clock fields in the
 * zone (`hours()`, `date()`…), formatting (`format()`), the calendar arithmetic (`add()`, `startOf()`, `diff()`) and
 * the comparisons (`isBefore()`…), across the daylight saving time changes. The time zone is an IANA name
 * (`'Asia/Shanghai'`); a new time is in the default zone: the `TZ` environment variable, else the system's (an invalid
 * `TZ` gives UTC, as for `Date`).
 *
 * A `Time` is immutable through its own methods: the setters and the arithmetic return a new instance, the time they
 * are called on does not change. It extends `Date`, so it is accepted where a `Date` is (`toISOString()`, `toJSON()`
 * and `getTime()` give the instant), but the methods inherited from `Date` (`getHours()`, `setHours()`…) read and
 * modify the time in the process's time zone, not in the instance's, and the setters modify the instance: use the
 * `Time` methods.
 *
 * An invalid time (an array field out of its range, `NaN`) does not throw: its `format()` gives `'Invalid date'` and
 * its getters `NaN`. An invalid string throws a `RangeError`.
 * @example
 * ```typescript
 * import {Time} from 'lakutata'
 *
 * const departure: Time = new Time('2024-03-09T12:00:00Z').timezone('America/New_York')
 * console.log(departure.format(), departure.format('dddd, MMMM Do YYYY, h:mm A z'))
 * //2024-03-09T07:00:00-05:00 Saturday, March 9th 2024, 7:00 AM EST
 * //Across the daylight saving time change: a day keeps the wall clock, 24 hours do not
 * console.log(departure.add(1, 'day').format(), departure.add(24, 'hours').format())
 * //2024-03-10T07:00:00-04:00 2024-03-10T08:00:00-04:00
 * console.log(departure.timezone('Asia/Shanghai').format('YYYY-MM-DD HH:mm'), departure.startOf('month').format())
 * //2024-03-09 20:00 2024-03-01T00:00:00-05:00
 * console.log(new Time('2024-03-31T00:00:00Z').diff('2024-01-15T00:00:00Z', 'months'))
 * //2
 * ```
 */
export class Time extends Date {

    /**
     * The time zone
     * @private
     */
    #zone: string

    /**
     * The instant and the offset last computed for it
     * @private
     */
    #offsetInstant: number = NaN

    #offsetMinutes: number = NaN

    /**
     * Create a time, in the default time zone (in the zone of `inp` when it is a `Time`). Call `timezone()` to get it
     * in another zone.
     * @param inp The time (see `TimeInput`): now when omitted or `null`, a `Time`, a `Date`, milliseconds since the
     * epoch, a date string, or the wall clock fields; a string without offset and the fields are read in the default
     * time zone.
     * @throws {RangeError} When `inp` is a string which is not a date (`''`, `'tomorrow'`).
     */
    constructor(inp?: TimeInput) {
        const zone: string = inp instanceof Time ? inp.#zone : defaultZone()
        super(inputToInstant(inp, zone))
        this.#zone = zone
    }

    /**
     * List the time zones of the runtime, by their current IANA names (`'Asia/Kolkata'`), plus `'UTC'` and the fixed
     * offsets `'Etc/GMT-14'` to `'Etc/GMT+12'`, sorted. `timezone()` also accepts the former names not listed
     * (`'Asia/Calcutta'`).
     * @returns A new array of names.
     */
    public static timezones(): string[] {
        return supportedZoneNames()
    }

    /**
     * Get the latest of several times.
     * @param times The times to compare. The invalid times are ignored.
     * @returns The latest valid time itself (not a copy), the first of the latest ones; the first time when all are
     * invalid; a new time of now when none is given.
     */
    public static max(...times: Time[]): Time {
        if (!times.length) return new Time()
        const valid: Time[] = times.filter((time: Time): boolean => !isNaN(time.getTime()))
        if (!valid.length) return times[0]
        return valid.reduce((max: Time, time: Time): Time => time.getTime() > max.getTime() ? time : max)
    }

    /**
     * Get the earliest of several times.
     * @param times The times to compare. The invalid times are ignored.
     * @returns The earliest valid time itself (not a copy), the first of the earliest ones; the first time when all
     * are invalid; a new time of now when none is given.
     */
    public static min(...times: Time[]): Time {
        if (!times.length) return new Time()
        const valid: Time[] = times.filter((time: Time): boolean => !isNaN(time.getTime()))
        if (!valid.length) return times[0]
        return valid.reduce((min: Time, time: Time): Time => time.getTime() < min.getTime() ? time : min)
    }

    /**
     * A new time of an instant, in the time zone
     * @param instant
     * @private
     */
    #at(instant: number): Time {
        const time: Time = new Time(instant)
        time.#zone = this.#zone
        return time
    }

    /**
     * A new time of wall clock fields (local milliseconds) in the time zone, keeping the current offset when the wall
     * clock time is repeated (see localToInstant)
     * @param local
     * @private
     */
    #atLocal(local: number): Time {
        return this.#at(localToInstant(this.#zone, local, this.#offset()))
    }

    /**
     * The instant of a time input, its strings without offset and its arrays read in the time zone
     * @param inp
     * @private
     */
    #input(inp: TimeInput | undefined): number {
        return inputToInstant(inp, this.#zone)
    }

    /**
     * The offset of the time zone (minutes)
     * @private
     */
    #offset(): number {
        const instant: number = this.getTime()
        if (instant !== this.#offsetInstant) {
            this.#offsetMinutes = offsetAt(this.#zone, instant)
            this.#offsetInstant = instant
        }
        return this.#offsetMinutes
    }

    /**
     * The wall clock fields in the time zone (read with the UTC methods)
     * @private
     */
    #local(): Date {
        return new Date(this.getTime() + this.#offset() * 60000)
    }

    /**
     * Sets a wall clock field
     * @param set
     * @private
     */
    #setLocal(set: (local: Date) => void): Time {
        const local: Date = this.#local()
        set(local)
        return this.#atLocal(local.getTime())
    }

    /**
     * Sets the month, keeping the day of the month in it
     * @param local
     * @param month
     * @private
     */
    static #setMonth(local: Date, month: number): void {
        if (isNaN(month)) return
        const date: number = Math.min(local.getUTCDate(), daysInMonth(local.getUTCFullYear(), month))
        local.setUTCMonth(month, date)
    }

    /**
     * Sets the year, keeping February 29th in February
     * @param local
     * @param year
     * @private
     */
    static #setYear(local: Date, year: number): void {
        if (isNaN(year)) return
        if (isLeapYear(local.getUTCFullYear()) && local.getUTCMonth() === 1 && local.getUTCDate() === 29) {
            local.setUTCFullYear(year, 1, daysInMonth(year, 1))
        } else {
            local.setUTCFullYear(year)
        }
    }

    /**
     * Get the offset of the time's zone as `Date` gives it: the minutes from the wall clock to UTC, so negative east of
     * Greenwich (`-480` in UTC+8, `300` in New York in winter). It changes with the daylight saving time.
     * @returns The offset in minutes; `NaN` for an invalid time.
     */
    public getTimezoneOffset(): number {
        const offset: number = this.#offset()
        return offset === 0 ? 0 : -offset
    }

    /**
     * Get the offset of the time's zone from UTC at this instant, in minutes: positive east of Greenwich (`480` in
     * UTC+8, `-300` in New York in winter, `-240` in summer).
     * @returns The offset in minutes; `NaN` for an invalid time.
     */
    public utcOffset(): number {
        return this.#offset()
    }

    /**
     * Get the time zone's IANA name (`'Asia/Shanghai'`).
     * @returns The name of the time zone.
     */
    public timezone(): string
    /**
     * Get the same instant in another time zone: the wall clock fields change, the instant does not.
     * @param tz The IANA name of the time zone (`'America/New_York'`, `'UTC'`, `'Etc/GMT-8'`). An empty string is the
     * default time zone (the `TZ` environment variable, else the system's).
     * @returns A new time in that zone.
     * @throws {RangeError} When the runtime does not know the time zone (`Invalid time zone: …`).
     */
    public timezone(tz: string): Time
    public timezone(tz?: string): string | Time {
        if (tz === undefined || tz === null) return this.#zone
        const zone: string = tz === '' ? defaultZone() : tz
        assertZone(zone)
        const time: Time = new Time(this.getTime())
        time.#zone = zone
        return time
    }

    /**
     * Get the milliseconds in the time's zone.
     * @returns The milliseconds, from 0 to 999; `NaN` for an invalid time.
     */
    public milliseconds(): number
    /**
     * Set the milliseconds. A value out of 0 to 999 carries over to the seconds (`1500` is 1.5 seconds later than 0).
     * @param value The new value; `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public milliseconds(value: number): Time
    public milliseconds(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCMilliseconds()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCMilliseconds(value))
    }

    /**
     * Get the seconds in the time's zone.
     * @returns The seconds, from 0 to 59; `NaN` for an invalid time.
     */
    public seconds(): number
    /**
     * Set the seconds. A value out of 0 to 59 carries over to the minutes.
     * @param value The new value; `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public seconds(value: number): Time
    public seconds(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCSeconds()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCSeconds(value))
    }

    /**
     * Get the minutes in the time's zone.
     * @returns The minutes, from 0 to 59; `NaN` for an invalid time.
     */
    public minutes(): number
    /**
     * Set the minutes. A value out of 0 to 59 carries over to the hours.
     * @param value The new value; `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public minutes(value: number): Time
    public minutes(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCMinutes()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCMinutes(value))
    }

    /**
     * Get the hours in the time's zone.
     * @returns The hours, from 0 to 23; `NaN` for an invalid time.
     */
    public hours(): number
    /**
     * Set the hours of the wall clock. A value out of 0 to 23 carries over to the days (`25` is 01:00 the next day).
     * A wall clock time skipped by a daylight saving time change (02:30 when the clocks jump from 02:00 to 03:00) moves
     * forward by the length of the gap (03:30), whatever the time it is set from; a repeated one (the clocks turned
     * back) keeps the offset of the time when it can, else is the earlier one.
     * @param value The new value; `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public hours(value: number): Time
    public hours(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCHours()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCHours(value))
    }

    /**
     * Get the day of the month in the time's zone.
     * @returns The day of the month, from 1 to 31; `NaN` for an invalid time.
     */
    public date(): number
    /**
     * Set the day of the month. A value out of the month's days carries over to the months (`32` in January is February
     * 1st, `0` the last day of the previous month).
     * @param value The new value; `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public date(value: number): Time
    public date(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCDate()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCDate(value))
    }

    /**
     * The day of the week (0 is Sunday), or a new time on another day of the same week
     * @param value
     * @private
     */
    #day(value?: number): number | Time {
        const day: number = this.#local().getUTCDay()
        return value === undefined ? day : this.add(value - day, 'd')
    }

    /**
     * Get the day of the week (weeks starting on Sunday) in the time's zone.
     * @returns The day of the week (weeks starting on Sunday), from 0 (Sunday) to 6 (Saturday); `NaN` for an invalid
     * time.
     */
    public weekday(): number
    /**
     * Move to another day of the same week (Sunday to Saturday), keeping the wall clock time. A value out of 0 to 6
     * moves to another week (`7` is the next Sunday, `-1` the previous Saturday).
     * @param value The new value, from 0 (Sunday) to 6 (Saturday).
     * @returns A new time; the time it is called on does not change.
     */
    public weekday(value: number): Time
    public weekday(value?: number): number | Time {
        const weekday: number = (this.#local().getUTCDay() + 7 - LOCALE_WEEK.dow) % 7
        return value === undefined ? weekday : this.add(value - weekday, 'd')
    }

    /**
     * Get the ISO day of the week in the time's zone.
     * @returns The ISO day of the week, from 1 (Monday) to 7 (Sunday); `NaN` for an invalid time.
     */
    public isoWeekday(): number
    /**
     * Move to another day of the same ISO week (Monday to Sunday), keeping the wall clock time. A value out of 1 to 7
     * moves to another week (`8` is the next Monday).
     * @param value The new value, from 1 (Monday) to 7 (Sunday).
     * @returns A new time; the time it is called on does not change.
     */
    public isoWeekday(value: number): Time
    public isoWeekday(value?: number): number | Time {
        const day: number = this.#day() as number
        if (value === undefined) return day || 7
        return this.#day(day % 7 ? value : value - 7)
    }

    /**
     * Get the day of the year in the time's zone.
     * @returns The day of the year, from 1 to 366; `NaN` for an invalid time.
     */
    public dayOfYear(): number
    /**
     * Move to another day of the year, keeping the wall clock time. A value out of the year's days carries over to the
     * next or previous years.
     * @param value The new value, from 1 to 366.
     * @returns A new time; the time it is called on does not change.
     */
    public dayOfYear(value: number): Time
    public dayOfYear(value?: number): number | Time {
        const dayOfYear: number = dayOfYearOf(this.#local().getTime())
        return value === undefined ? dayOfYear : this.add(value - dayOfYear, 'd')
    }

    /**
     * Get the week of the year (weeks starting on Sunday, week 1 holding January 1st) in the time's zone.
     * @returns The week of the year (weeks starting on Sunday, week 1 holding January 1st), from 1 to 53; `NaN` for an
     * invalid time.
     */
    public weeks(): number
    /**
     * Move to another week of the year, keeping the day of the week and the wall clock time (`weeks(w)` adds
     * `w - weeks()` weeks).
     * @param value The new value, from 1 to 53.
     * @returns A new time; the time it is called on does not change.
     */
    public weeks(value: number): Time
    public weeks(value?: number): number | Time {
        const week: number = weekOfYear(this.#local().getTime(), LOCALE_WEEK).week
        return value === undefined ? week : this.add((value - week) * 7, 'd')
    }

    /**
     * Get the ISO 8601 week of the year (weeks starting on Monday, week 1 holding the first Thursday) in the time's
     * zone.
     * @returns The ISO 8601 week of the year (weeks starting on Monday, week 1 holding the first Thursday), from 1 to
     * 53; `NaN` for an invalid time.
     */
    public isoWeeks(): number
    /**
     * Move to another ISO week, keeping the day of the week and the wall clock time.
     * @param value The new value, from 1 to 53.
     * @returns A new time; the time it is called on does not change.
     */
    public isoWeeks(value: number): Time
    public isoWeeks(value?: number): number | Time {
        const week: number = weekOfYear(this.#local().getTime(), ISO_WEEK).week
        return value === undefined ? week : this.add((value - week) * 7, 'd')
    }

    /**
     * Get the month in the time's zone.
     * @returns The month, from 0 (January) to 11 (December); `NaN` for an invalid time.
     */
    public month(): number
    /**
     * Set the month, keeping the day of the month when it exists in it, else taking the month's last day (January 31st
     * set to February gives February 29th in 2024). A value out of 0 to 11 carries over to the years (`12` is January
     * of the next year).
     * @param value The new value, from 0 (January) to 11 (December); `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public month(value: number): Time
    public month(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCMonth()
        return this.#setLocal((local: Date): void => Time.#setMonth(local, value))
    }

    /**
     * Get the quarter in the time's zone.
     * @returns The quarter, from 1 to 4; `NaN` for an invalid time.
     */
    public quarters(): number
    /**
     * Move to another quarter of the year, keeping the month's position in its quarter and the day of the month when it
     * exists (May 15th set to quarter 1 gives February 15th).
     * @param value The new value, from 1 to 4.
     * @returns A new time; the time it is called on does not change.
     */
    public quarters(value: number): Time
    public quarters(value?: number): number | Time {
        const month: number = this.#local().getUTCMonth()
        return value === undefined ? Math.ceil((month + 1) / 3) : this.month((value - 1) * 3 + month % 3)
    }

    /**
     * Get the year in the time's zone.
     * @returns The year, such as `2024`; `NaN` for an invalid time.
     */
    public year(): number
    /**
     * Set the year, keeping the month and the day; February 29th becomes February 28th in a year which is not a leap
     * year.
     * @param value The new value, within the range of `Date` (about ±270,000); `NaN` leaves the time unchanged.
     * @returns A new time; the time it is called on does not change.
     */
    public year(value: number): Time
    public year(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCFullYear()
        return this.#setLocal((local: Date): void => Time.#setYear(local, value))
    }

    /**
     * The week year, or a new time in another week year (same week, same day of the week)
     * @param rules
     * @param value
     * @private
     */
    #weekYear(rules: WeekRules, value?: number): number | Time {
        const local: Date = this.#local()
        const {week, year} = weekOfYear(local.getTime(), rules)
        if (value === undefined) return year
        const target: { year: number, dayOfYear: number } = dayOfYearFromWeeks(value, Math.min(week, weeksInYear(value, rules)), local.getUTCDay() || (rules.dow ? 7 : 0), rules)
        const date: Date = new Date(localMilliseconds(target.year, 0, target.dayOfYear))
        return this.#setLocal((fields: Date): void => {
            Time.#setYear(fields, date.getUTCFullYear())
            Time.#setMonth(fields, date.getUTCMonth())
            fields.setUTCDate(date.getUTCDate())
        })
    }

    /**
     * Get the ISO 8601 week-numbering year: the year of the ISO week, which differs from the calendar year around
     * January 1st (December 30th 2024 is in the week 1 of 2025).
     * @returns The ISO week year; `NaN` for an invalid time.
     */
    public isoWeekYear(): number
    /**
     * Move to another ISO week year, keeping the ISO week (clamped to the weeks of that year), the day of the week and
     * the wall clock time.
     * @param value The ISO week year.
     * @returns A new time; the time it is called on does not change.
     */
    public isoWeekYear(value: number): Time
    public isoWeekYear(value?: number): number | Time {
        return this.#weekYear(ISO_WEEK, value)
    }

    /**
     * Get the number of weeks of the time's year, the weeks starting on Sunday (see `weeks()`).
     * @returns 52 or 53.
     */
    public weeksInYear(): number {
        return weeksInYear(this.#local().getUTCFullYear(), LOCALE_WEEK)
    }

    /**
     * Get the number of ISO 8601 weeks of the time's calendar year.
     * @returns 52 or 53.
     */
    public isoWeeksInYear(): number {
        return weeksInYear(this.#local().getUTCFullYear(), ISO_WEEK)
    }

    /**
     * Get a field by its unit: `get('hour')` is `hours()`, `get('D')` is `date()`, `get('day')` the day of the week (0
     * is Sunday), `get('weekYear')` the year of the week (weeks starting on Sunday).
     * @param unit The unit of the field (see `UnitOfTime.All`).
     * @returns The field's value; `NaN` for a unit which is not one.
     */
    public get(unit: UnitOfTime.All): number {
        return this.#getSet(unit) as number
    }

    /**
     * Set a field by its unit: `set('hour', 8)` is `hours(8)`, `set('day', 1)` moves to the Monday of the week.
     * @param unit The unit of the field (see `UnitOfTime.All`). A unit which is not one returns an unchanged copy.
     * @param value The new value, with the rules of the field's setter.
     * @returns A new time; the time it is called on does not change.
     */
    public set(unit: UnitOfTime.All, value: number): Time {
        return this.#getSet(unit, value) as Time
    }

    /**
     * Gets or sets a unit
     * @param unit
     * @param value
     * @private
     */
    #getSet(unit: string, value?: number): number | Time {
        switch (normalizeUnit(unit)) {
            case 'year':
                return value === undefined ? this.year() : this.year(value)
            case 'quarter':
                return value === undefined ? this.quarters() : this.quarters(value)
            case 'month':
                return value === undefined ? this.month() : this.month(value)
            case 'week':
                return value === undefined ? this.weeks() : this.weeks(value)
            case 'isoWeek':
                return value === undefined ? this.isoWeeks() : this.isoWeeks(value)
            case 'day':
                return this.#day(value)
            case 'date':
                return value === undefined ? this.date() : this.date(value)
            case 'hour':
                return value === undefined ? this.hours() : this.hours(value)
            case 'minute':
                return value === undefined ? this.minutes() : this.minutes(value)
            case 'second':
                return value === undefined ? this.seconds() : this.seconds(value)
            case 'millisecond':
                return value === undefined ? this.milliseconds() : this.milliseconds(value)
            case 'dayOfYear':
                return value === undefined ? this.dayOfYear() : this.dayOfYear(value)
            case 'weekday':
                return value === undefined ? this.weekday() : this.weekday(value)
            case 'isoWeekday':
                return value === undefined ? this.isoWeekday() : this.isoWeekday(value)
            case 'weekYear':
                return this.#weekYear(LOCALE_WEEK, value)
            case 'isoWeekYear':
                return this.#weekYear(ISO_WEEK, value)
            default:
                return value === undefined ? NaN : this.clone()
        }
    }

    /**
     * Adds a duration: the months and the days to the wall clock (their fractions are rounded), the other units to the
     * instant
     * @param amount
     * @param unit
     * @param sign
     * @private
     */
    #addDuration(amount: number, unit: string | undefined, sign: number): Time {
        const normalized: Unit | undefined = unit === undefined ? 'millisecond' : normalizeUnit(unit)
        let months: number = 0
        let days: number = 0
        let milliseconds: number = 0
        switch (normalized) {
            case 'year':
                months = amount * 12
                break
            case 'quarter':
                months = amount * 3
                break
            case 'month':
                months = amount
                break
            case 'week':
            case 'isoWeek':
                days = amount * 7
                break
            case 'day':
                days = amount
                break
            case 'hour':
                milliseconds = amount * 36e5
                break
            case 'minute':
                milliseconds = amount * 6e4
                break
            case 'second':
                milliseconds = amount * 1e3
                break
            case 'millisecond':
                milliseconds = amount
                break
            default:
                return this.clone()
        }
        months = absRound(months) * sign
        days = absRound(days) * sign
        if (months || days) {
            return this.#setLocal((local: Date): void => {
                if (months) Time.#setMonth(local, local.getUTCMonth() + months)
                if (days) local.setUTCDate(local.getUTCDate() + days)
            })
        }
        return this.#at(this.getTime() + milliseconds * sign)
    }

    /**
     * Add a duration. The years, quarters, months, weeks and days move the wall clock, keeping its time across a
     * daylight saving time change (a day can last 23 or 25 hours), and a month without the day of the month takes its
     * last day (January 31st plus a month is February 29th in 2024). The hours, minutes, seconds and milliseconds move
     * the instant. A wall clock time skipped by a daylight saving time change (02:30 when the clocks jump from 02:00 to
     * 03:00) moves forward by the length of the gap (03:30), whatever the time it comes from.
     * @param amount The amount, negative to go back. The fractions of the months and the days are rounded half away
     * from zero (`1.5` days is 2 days, `0.5` year is 6 months); the other units keep them (`1.5` hours is 90 minutes).
     * @param unit The unit (see `UnitOfTime.DurationConstructor`). A unit which is not one returns an unchanged copy.
     * @returns A new time; the time it is called on does not change.
     */
    public add(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return this.#addDuration(amount, unit, 1)
    }

    /**
     * Subtract a duration: `subtract(n, unit)` is `add(-n, unit)` (see `add` for the daylight saving time changes and
     * the month ends).
     * @param amount The amount, negative to go forward.
     * @param unit The unit (see `UnitOfTime.DurationConstructor`). A unit which is not one returns an unchanged copy.
     * @returns A new time; the time it is called on does not change.
     */
    public subtract(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return this.#addDuration(amount, unit, -1)
    }

    /**
     * The wall clock at the start (or the end) of a unit (undefined: not a unit)
     * @param unit
     * @param end
     * @private
     */
    #boundary(unit: UnitOfTime.StartOf, end: boolean): number | undefined {
        const local: Date = this.#local()
        const year: number = local.getUTCFullYear()
        const month: number = local.getUTCMonth()
        const date: number = local.getUTCDate()
        const time: number = local.getTime()
        const next: number = end ? 1 : 0
        const floor = (size: number): number => time - ((time % size) + size) % size + next * size - next
        switch (normalizeUnit(unit)) {
            case 'year':
                return localMilliseconds(year + next, 0, 1) - next
            case 'quarter':
                return localMilliseconds(year, month - (month % 3) + next * 3, 1) - next
            case 'month':
                return localMilliseconds(year, month + next, 1) - next
            case 'week':
                return localMilliseconds(year, month, date - (local.getUTCDay() + 7 - LOCALE_WEEK.dow) % 7 + next * 7) - next
            case 'isoWeek':
                return localMilliseconds(year, month, date - ((local.getUTCDay() || 7) - 1) + next * 7) - next
            case 'day':
            case 'date':
                return localMilliseconds(year, month, date + next) - next
            case 'hour':
                return floor(36e5)
            case 'minute':
                return floor(6e4)
            case 'second':
                return floor(1e3)
            default:
                return undefined
        }
    }

    /**
     * Get the start of the unit holding the time, in its zone: `startOf('day')` is midnight (or the first time of the
     * day when the clocks skip midnight), `startOf('week')` the Sunday, `startOf('isoWeek')` the Monday,
     * `startOf('month')` the 1st, `startOf('hour')` the hour with zero minutes.
     * @param unit The unit (see `UnitOfTime.StartOf`). `'millisecond'`, `null` or a unit which is not one returns an
     * unchanged copy.
     * @returns A new time; the time it is called on does not change.
     */
    public startOf(unit: UnitOfTime.StartOf): Time {
        const local: number | undefined = this.#boundary(unit, false)
        return local === undefined ? this.clone() : this.#atLocal(local)
    }

    /**
     * Get the end of the unit holding the time, in its zone: its last millisecond (`endOf('day')` is 23:59:59.999,
     * `endOf('month')` the last day of the month at 23:59:59.999).
     * @param unit The unit (see `UnitOfTime.StartOf`). `'millisecond'`, `null` or a unit which is not one returns an
     * unchanged copy.
     * @returns A new time; the time it is called on does not change.
     */
    public endOf(unit: UnitOfTime.StartOf): Time {
        const local: number | undefined = this.#boundary(unit, true)
        return local === undefined ? this.clone() : this.#atLocal(local)
    }

    /**
     * Format the time in its zone as ISO 8601 with its offset, to the second: `'2024-03-09T07:00:00-05:00'`, or
     * `'2024-03-09T12:00:00Z'` at the offset zero.
     * @returns The formatted time; `'Invalid date'` for an invalid time.
     */
    public format(): string
    /**
     * Format the time in its zone with the tokens of the moment library (in English):
     * - year `YYYY` (2024), `YY` (24); quarter `Q`; month `M` (3), `MM` (03), `MMM` (Mar), `MMMM` (March), `Mo` (3rd);
     * - day of the month `D`, `DD`, `Do` (9th); day of the year `DDD`, `DDDD`; day of the week `d` (0 is Sunday), `dd`
     *   (Sa), `ddd` (Sat), `dddd` (Saturday), `E` (ISO, 1 is Monday); weeks `w`, `ww`, ISO weeks `W`, `WW`; week years
     *   `gggg`, `GGGG`;
     * - hours `H`, `HH` (0-23), `h`, `hh` (1-12), `k`, `kk` (1-24); `A` (AM/PM), `a` (am/pm); minutes `m`, `mm`;
     *   seconds `s`, `ss`; fractions `S` to `SSSSSSSSS` (`SSS` the milliseconds);
     * - offset `Z` (-05:00), `ZZ` (-0500); the zone's abbreviation `z` (EST, or GMT+8 where English has none); the
     *   timestamp `X` (seconds), `x` (milliseconds);
     * - the localized formats `LT` (7:00 AM), `LTS`, `L` (03/09/2024), `LL` (March 9, 2024), `LLL`, `LLLL`, and their
     *   short forms `l`, `ll`, `lll`, `llll`.
     *
     * The text in brackets is kept as is (`[at]`, `[T]`); the other characters which are not tokens too.
     * @param format The format (`'YYYY-MM-DD HH:mm:ss'`, `'dddd, MMMM Do YYYY'`); an empty string gives the default
     * format.
     * @returns The formatted time; `'Invalid date'` for an invalid time.
     */
    public format(format: string): string
    public format(format?: string): string {
        const instant: number = this.getTime()
        const offset: number = this.#offset()
        const context: FormatContext = {
            local: new Date(instant + offset * 60000),
            instant,
            offset,
            abbreviation: (): string => zoneAbbreviation(this.#zone, instant)
        }
        //At an offset of zero, the default format ends with Z
        return formatTime(format || (offset === 0 ? DEFAULT_UTC_FORMAT : DEFAULT_FORMAT), context)
    }

    /**
     * The months from a time to another (with a fraction)
     * @param a
     * @param b
     * @private
     */
    static #monthDiff(a: Time, b: Time): number {
        if (a.date() < b.date()) return -Time.#monthDiff(b, a)
        const wholeMonthDiff: number = (b.year() - a.year()) * 12 + (b.month() - a.month())
        const anchor: number = a.add(wholeMonthDiff, 'months').getTime()
        let adjust: number
        if (b.getTime() - anchor < 0) {
            const anchor2: number = a.add(wholeMonthDiff - 1, 'months').getTime()
            adjust = (b.getTime() - anchor) / (anchor - anchor2)
        } else {
            const anchor2: number = a.add(wholeMonthDiff + 1, 'months').getTime()
            adjust = (b.getTime() - anchor) / (anchor2 - anchor)
        }
        return -(wholeMonthDiff + adjust) || 0
    }

    /**
     * Get the time elapsed from another time to this one, in a unit: positive when this time is later. The months,
     * quarters and years count calendar months (January 15th to March 15th is 2 months whatever their days); the days
     * and weeks count the wall clock days in this time's zone (a 23-hour day across a daylight saving time change is
     * one day); the hours, minutes, seconds and milliseconds count the elapsed time.
     * @param inp The other time (see `TimeInput`); now when `null`.
     * @param unit The unit (see `UnitOfTime.Diff`); milliseconds when omitted or not a unit.
     * @param precise Whether the result keeps its fraction; by default it is truncated toward zero (`2.5` months gives
     * `2`, `-2.5` gives `-2`).
     * @returns The difference.
     * @throws {RangeError} When `inp` is a string which is not a date.
     */
    public diff(inp: TimeInput, unit?: UnitOfTime.Diff, precise?: boolean): number {
        const that: Time = this.#at(this.#input(inp))
        const zoneDelta: number = (that.#offset() - this.#offset()) * 6e4
        const delta: number = this.getTime() - that.getTime()
        let output: number
        switch (normalizeUnit(unit)) {
            case 'year':
                output = Time.#monthDiff(this, that) / 12
                break
            case 'month':
                output = Time.#monthDiff(this, that)
                break
            case 'quarter':
                output = Time.#monthDiff(this, that) / 3
                break
            case 'second':
                output = delta / 1e3
                break
            case 'minute':
                output = delta / 6e4
                break
            case 'hour':
                output = delta / 36e5
                break
            case 'day':
                output = (delta - zoneDelta) / 864e5
                break
            case 'week':
                output = (delta - zoneDelta) / 6048e5
                break
            default:
                output = delta
        }
        return precise ? output : absFloor(output)
    }

    /**
     * Get the Unix timestamp: the whole seconds since the Unix epoch, rounded down (`-1.5` seconds gives `-2`).
     * @returns The seconds; `NaN` for an invalid time.
     */
    public unix(): number {
        return Math.floor(this.getTime() / 1000)
    }

    /**
     * Get the number of days of the time's month, in its zone.
     * @returns 28 to 31.
     */
    public daysInMonth(): number {
        const local: Date = this.#local()
        return daysInMonth(local.getUTCFullYear(), local.getUTCMonth())
    }

    /**
     * Get the wall clock fields in the time's zone, in the order of the `Date` constructor. Passed back to `new
     * Time()`, they are read in the default time zone: the instant differs when the zones differ; passed to a
     * comparison of this time (`isSame(time.toArray())`), they are read in its zone.
     * @returns `[year, month, date, hours, minutes, seconds, milliseconds]`, the month from 0 (January) to 11.
     */
    public toArray(): [number, number, number, number, number, number, number] {
        const local: Date = this.#local()
        return [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()]
    }

    /**
     * Get the wall clock fields in the time's zone, by name.
     * @returns The year, the month (from 0), the day of the month, the hours, minutes, seconds and milliseconds.
     */
    public toObject(): TimeObject {
        const [years, months, date, hours, minutes, seconds, milliseconds] = this.toArray()
        return {years, months, date, hours, minutes, seconds, milliseconds}
    }

    /**
     * Format the time in its zone as `Date` does, without the zone's name: `'Fri Mar 01 2024 07:30:00 GMT+0800'`.
     * @returns The formatted time; `'Invalid date'` for an invalid time (`Date` gives `'Invalid Date'`).
     */
    public toString(): string {
        return this.format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ')
    }

    /**
     * Format the time of the day in its zone as `Date` does: `'07:30:00 GMT+0800 (China Standard Time)'`.
     * @returns The formatted time; `'Invalid Date'` for an invalid time.
     */
    public toTimeString(): string {
        if (isNaN(this.getTime())) return 'Invalid Date'
        return `${this.format('HH:mm:ss [GMT]ZZ')} (${zoneLongName(this.#zone, this.getTime())})`
    }

    /**
     * Format the date in its zone as `Date` does: `'Fri Mar 01 2024'`.
     * @returns The formatted date; `'Invalid date'` for an invalid time.
     */
    public toDateString(): string {
        return this.format('ddd MMM DD YYYY')
    }

    /**
     * Convert the time into a plain `Date` of the same instant (a `Date` has no time zone: its local methods use the
     * process's zone).
     * @returns A new `Date`.
     */
    public toDate(): Date {
        return new Date(this.getTime())
    }

    /**
     * Tell whether this time is before another one. With a granularity, the unit holding this time must end before the
     * other time: `isBefore(other, 'day')` is `true` when this time's day is before the other's.
     * @param inp The other time (see `TimeInput`); now when omitted or `null`.
     * @param granularity The unit to compare at (see `UnitOfTime.StartOf`), in this time's zone; the exact instant when
     * omitted, `null` or `'millisecond'`.
     * @returns `true` when this time is before; `false` for an invalid time.
     * @throws {RangeError} When `inp` is a string which is not a date.
     */
    public isBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        const input: number = this.#input(inp)
        if (!normalizeUnit(granularity) || normalizeUnit(granularity) === 'millisecond') return this.getTime() < input
        return this.endOf(granularity!).getTime() < input
    }

    /**
     * Tell whether this time is the same as another one. With a granularity, whether the other time falls in the same
     * unit: `isSame(other, 'day')` is the same calendar day in this time's zone.
     * @param inp The other time (see `TimeInput`); now when omitted or `null`.
     * @param granularity The unit to compare at (see `UnitOfTime.StartOf`), in this time's zone; the exact instant when
     * omitted, `null` or `'millisecond'`.
     * @returns `true` when they are the same; `false` for an invalid time.
     * @throws {RangeError} When `inp` is a string which is not a date.
     */
    public isSame(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        const input: number = this.#input(inp)
        if (!normalizeUnit(granularity) || normalizeUnit(granularity) === 'millisecond') return this.getTime() === input
        return this.startOf(granularity!).getTime() <= input && input <= this.endOf(granularity!).getTime()
    }

    /**
     * Tell whether this time is after another one. With a granularity, the unit holding this time must start after the
     * other time: `isAfter(other, 'day')` is `true` when this time's day is after the other's.
     * @param inp The other time (see `TimeInput`); now when omitted or `null`.
     * @param granularity The unit to compare at (see `UnitOfTime.StartOf`), in this time's zone; the exact instant when
     * omitted, `null` or `'millisecond'`.
     * @returns `true` when this time is after; `false` for an invalid time.
     * @throws {RangeError} When `inp` is a string which is not a date.
     */
    public isAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        const input: number = this.#input(inp)
        if (!normalizeUnit(granularity) || normalizeUnit(granularity) === 'millisecond') return this.getTime() > input
        return input < this.startOf(granularity!).getTime()
    }

    /**
     * Tell whether this time is the same as another one or before it (`isSame() || isBefore()`).
     * @param inp The other time (see `TimeInput`); now when omitted or `null`.
     * @param granularity The unit to compare at (see `UnitOfTime.StartOf`), in this time's zone; the exact instant when
     * omitted, `null` or `'millisecond'`.
     * @returns `true` when this time is the same or before.
     * @throws {RangeError} When `inp` is a string which is not a date.
     */
    public isSameOrBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.isSame(inp, granularity) || this.isBefore(inp, granularity)
    }

    /**
     * Tell whether this time is the same as another one or after it (`isSame() || isAfter()`).
     * @param inp The other time (see `TimeInput`); now when omitted or `null`.
     * @param granularity The unit to compare at (see `UnitOfTime.StartOf`), in this time's zone; the exact instant when
     * omitted, `null` or `'millisecond'`.
     * @returns `true` when this time is the same or after.
     * @throws {RangeError} When `inp` is a string which is not a date.
     */
    public isSameOrAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.isSame(inp, granularity) || this.isAfter(inp, granularity)
    }

    /**
     * Tell whether this time is between two others, excluding them by default.
     * @param a The start (see `TimeInput`); now when `null`. It must be the earlier one: the times are not swapped.
     * @param b The end (see `TimeInput`); now when `null`.
     * @param granularity The unit to compare at (see `UnitOfTime.StartOf`), in this time's zone; the exact instant when
     * omitted, `null` or `'millisecond'`.
     * @param inclusivity Whether the start and the end are included: `'()'` (excluded, the default), `'[)'` (the start
     * included), `'(]'` (the end included) or `'[]'` (both).
     * @returns `true` when this time is between them.
     * @throws {RangeError} When `a` or `b` is a string which is not a date.
     */
    public isBetween(a: TimeInput, b: TimeInput, granularity?: UnitOfTime.StartOf, inclusivity: '()' | '[)' | '(]' | '[]' = '()'): boolean {
        return (inclusivity[0] === '(' ? this.isAfter(a, granularity) : !this.isBefore(a, granularity)) &&
            (inclusivity[1] === ')' ? this.isBefore(b, granularity) : !this.isAfter(b, granularity))
    }

    /**
     * Tell whether the time's year (in its zone) is a leap year.
     * @returns `true` for a leap year.
     */
    public isLeapYear(): boolean {
        return isLeapYear(this.#local().getUTCFullYear())
    }

    /**
     * Copy the time: the same instant in the same time zone.
     * @returns A new time.
     */
    public clone(): Time {
        return this.#at(this.getTime())
    }
}
