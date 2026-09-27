import {AssertZone, DefaultZone, OffsetAt, ZoneAbbreviation, ZoneLongName, ZoneNames} from './time/Zone.js'
import {
    DayOfYear,
    DayOfYearFromWeeks,
    DaysInMonth,
    ISO_WEEK,
    IsLeapYear,
    LOCALE_WEEK,
    LocalMilliseconds,
    WeekOfYear,
    WeeksInYear,
    type WeekRules
} from './time/Calendar.js'
import {DEFAULT_FORMAT, DEFAULT_UTC_FORMAT, type FormatContext, FormatTime} from './time/Format.js'

export namespace UnitOfTime {
    export type Base = (
        'year' | 'years' | 'y' |
        'month' | 'months' | 'M' |
        'week' | 'weeks' | 'w' |
        'day' | 'days' | 'd' |
        'hour' | 'hours' | 'h' |
        'minute' | 'minutes' | 'm' |
        'second' | 'seconds' | 's' |
        'millisecond' | 'milliseconds' | 'ms'
        );

    export type _quarter = 'quarter' | 'quarters' | 'Q';
    export type _isoWeek = 'isoWeek' | 'isoWeeks' | 'W';
    export type _date = 'date' | 'dates' | 'D';
    export type DurationConstructor = Base | _quarter;

    export type DurationAs = Base;

    export type StartOf = Base | _quarter | _isoWeek | _date | null;

    export type Diff = Base | _quarter;

    export type MomentConstructor = Base | _date;

    export type All = Base | _quarter | _isoWeek | _date |
        'weekYear' | 'weekYears' | 'gg' |
        'isoWeekYear' | 'isoWeekYears' | 'GG' |
        'dayOfYear' | 'dayOfYears' | 'DDD' |
        'weekday' | 'weekdays' | 'e' |
        'isoWeekday' | 'isoWeekdays' | 'E';
}

export type TimeInput = Time | Date | string | number | (number | string)[] | null

export type TimeObject = {
    years: number;
    /* One digit */
    months: number;
    /* Day of the month */
    date: number;
    hours: number;
    minutes: number;
    seconds: number;
    milliseconds: number;
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
 * The instant of a time string: a timestamp in milliseconds, or a date string
 * @param input
 * @throws RangeError when the string is not a time
 */
function parseTimeString(input: string): number {
    const value: number = /^\s*$/.test(input) ? NaN : /^[+-]?\d+(\.\d+)?$/.test(input) ? new Date(parseFloat(input)).getTime() : new Date(input).getTime()
    if (isNaN(value)) throw new RangeError(`Invalid time value: "${input}"`)
    return value
}

/**
 * The instant of wall clock fields of the time zone of the process ([year, month, date, hours, minutes, seconds,
 * milliseconds]: the leading missing fields are the current ones, the other missing fields are the smallest); fields out
 * of their range make an invalid time
 * @param input
 */
function arrayToTime(input: (number | string)[]): number {
    const fields: (number | undefined)[] = input.slice(0, 7).map((field: number | string): number => typeof field === 'number' ? field : parseInt(field, 10))
    const now: Date = new Date()
    const current: number[] = [now.getFullYear(), now.getMonth(), now.getDate()]
    let i: number = 0
    for (; i < 3 && fields[i] === undefined; i++) fields[i] = current[i]
    for (; i < 7; i++) if (fields[i] === undefined) fields[i] = i === 2 ? 1 : 0
    const [year, month, date, hours, minutes, seconds, milliseconds] = fields as number[]
    const overflow: boolean = month < 0 || month > 11 ||
        date < 1 || date > DaysInMonth(year, month) ||
        hours < 0 || hours > 24 || (hours === 24 && (minutes !== 0 || seconds !== 0 || milliseconds !== 0)) ||
        minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59 || milliseconds < 0 || milliseconds > 999
    if (overflow) return NaN
    const local: Date = new Date(2000, 0, 1)
    local.setFullYear(year, month, date)
    local.setHours(hours, minutes, seconds, milliseconds)
    return local.getTime()
}

/**
 * Time class: a Date in a time zone. The methods returning a Time return a new instance (the instance they are called
 * on does not change); the Date methods are the ones of Date.
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
     * Constructor
     * @param inp the time (default: now): a Time (its time zone too), a Date, a timestamp in milliseconds, a date string,
     *  or the wall clock fields of the time zone of the process [year, month, date, hours, minutes, seconds, milliseconds]
     */
    constructor(inp?: TimeInput) {
        let zone: string | undefined
        let value: number
        if (inp === undefined || inp === null) {
            value = Date.now()
        } else if (inp instanceof Time) {
            value = inp.getTime()
            zone = inp.#zone
        } else if (inp instanceof Date) {
            value = inp.getTime()
        } else if (typeof inp === 'number') {
            value = inp
        } else if (typeof inp === 'string') {
            value = parseTimeString(inp)
        } else if (Array.isArray(inp)) {
            value = arrayToTime(inp)
        } else {
            value = NaN
        }
        super(value)
        this.#zone = zone || DefaultZone()
    }

    /**
     * Get all timezone names
     */
    public static timezones(): string[] {
        return ZoneNames()
    }

    /**
     * Returns the maximum value for a given instance (farthest into the future)
     * @param times
     */
    public static max(...times: Time[]): Time {
        if (!times.length) return new Time()
        return times.reduce((max: Time, time: Time): Time => time.getTime() > max.getTime() ? time : max)
    }

    /**
     * Returns the minimum value (most distant past) of the given instance
     * @param times
     */
    public static min(...times: Time[]): Time {
        if (!times.length) return new Time()
        return times.reduce((min: Time, time: Time): Time => time.getTime() < min.getTime() ? time : min)
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
     * A new time of wall clock fields (local milliseconds) in the time zone: the offset of the time zone at the instant
     * they make with the current offset (at a transition, a wall clock time which does not exist moves forward)
     * @param local
     * @private
     */
    #atLocal(local: number): Time {
        const offset: number = OffsetAt(this.#zone, local - this.#offset() * 60000)
        return this.#at(local - offset * 60000)
    }

    /**
     * The offset of the time zone (minutes)
     * @private
     */
    #offset(): number {
        const instant: number = this.getTime()
        if (instant !== this.#offsetInstant) {
            this.#offsetMinutes = OffsetAt(this.#zone, instant)
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
        const date: number = Math.min(local.getUTCDate(), DaysInMonth(local.getUTCFullYear(), month))
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
        if (IsLeapYear(local.getUTCFullYear()) && local.getUTCMonth() === 1 && local.getUTCDate() === 29) {
            local.setUTCFullYear(year, 1, DaysInMonth(year, 1))
        } else {
            local.setUTCFullYear(year)
        }
    }

    /**
     * Get time zone offset: the minutes from the time in the time zone to UTC, like Date (-480 for UTC+8)
     */
    public getTimezoneOffset(): number {
        const offset: number = this.#offset()
        return offset === 0 ? 0 : -offset
    }

    /**
     * Get the offset of the time zone from UTC in minutes (480 for UTC+8)
     */
    public utcOffset(): number {
        return this.#offset()
    }

    /**
     * Get or set time zone
     */
    public timezone(): string
    public timezone(tz: string): Time
    public timezone(tz?: string): string | Time {
        if (!tz) return this.#zone
        AssertZone(tz)
        const time: Time = new Time(this.getTime())
        time.#zone = tz
        return time
    }

    /**
     * Get or set the number of milliseconds
     */
    public milliseconds(): number
    public milliseconds(value: number): Time
    public milliseconds(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCMilliseconds()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCMilliseconds(value))
    }

    /**
     * Get or set seconds
     */
    public seconds(): number
    public seconds(value: number): Time
    public seconds(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCSeconds()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCSeconds(value))
    }

    /**
     * Get or set minutes
     */
    public minutes(): number
    public minutes(value: number): Time
    public minutes(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCMinutes()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCMinutes(value))
    }

    /**
     * Get or set the hour
     */
    public hours(): number
    public hours(value: number): Time
    public hours(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCHours()
        return isNaN(value) ? this.clone() : this.#setLocal((local: Date): number => local.setUTCHours(value))
    }

    /**
     * Get or set the day of the month
     * Accepts numbers from 1 to 31. If out of range it will bubble up to months
     */
    public date(): number
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
     * Set to get or set the day of the week
     */
    public weekday(): number
    public weekday(value: number): Time
    public weekday(value?: number): number | Time {
        const weekday: number = (this.#local().getUTCDay() + 7 - LOCALE_WEEK.dow) % 7
        return value === undefined ? weekday : this.add(value - weekday, 'd')
    }

    /**
     * Get or set the ISO day of the week, 1 is Monday, 7 is Sunday
     */
    public isoWeekday(): number
    public isoWeekday(value: number): Time
    public isoWeekday(value?: number): number | Time {
        const day: number = this.#day() as number
        if (value === undefined) return day || 7
        return this.#day(day % 7 ? value : value - 7)
    }

    /**
     * Get or set the day of the year
     * Accepts numbers from 1 to 366. If out of range it will bubble up to the year
     */
    public dayOfYear(): number
    public dayOfYear(value: number): Time
    public dayOfYear(value?: number): number | Time {
        const dayOfYear: number = DayOfYear(this.#local().getTime())
        return value === undefined ? dayOfYear : this.add(value - dayOfYear, 'd')
    }

    /**
     * Gets or sets the week of the year
     */
    public weeks(): number
    public weeks(value: number): Time
    public weeks(value?: number): number | Time {
        const week: number = WeekOfYear(this.#local().getTime(), LOCALE_WEEK).week
        return value === undefined ? week : this.add((value - week) * 7, 'd')
    }

    /**
     * Gets or sets the ISO week of the year
     */
    public isoWeeks(): number
    public isoWeeks(value: number): Time
    public isoWeeks(value?: number): number | Time {
        const week: number = WeekOfYear(this.#local().getTime(), ISO_WEEK).week
        return value === undefined ? week : this.add((value - week) * 7, 'd')
    }

    /**
     * Get or set the month
     * Accepts numbers from 0 to 11. If out of range it will bubble up to the year
     */
    public month(): number
    public month(value: number): Time
    public month(value?: number): number | Time {
        if (value === undefined) return this.#local().getUTCMonth()
        return this.#setLocal((local: Date): void => Time.#setMonth(local, value))
    }

    /**
     * Gets or sets the quarter (1 to 4)
     */
    public quarters(): number
    public quarters(value: number): Time
    public quarters(value?: number): number | Time {
        const month: number = this.#local().getUTCMonth()
        return value === undefined ? Math.ceil((month + 1) / 3) : this.month((value - 1) * 3 + month % 3)
    }

    /**
     * Get or set the year
     * Accepts numbers from -270,000 to 270,000
     */
    public year(): number
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
        const {week, year} = WeekOfYear(local.getTime(), rules)
        if (value === undefined) return year
        const target: { year: number, dayOfYear: number } = DayOfYearFromWeeks(value, Math.min(week, WeeksInYear(value, rules)), local.getUTCDay() || (rules.dow ? 7 : 0), rules)
        const date: Date = new Date(LocalMilliseconds(target.year, 0, target.dayOfYear))
        return this.#setLocal((fields: Date): void => {
            Time.#setYear(fields, date.getUTCFullYear())
            Time.#setMonth(fields, date.getUTCMonth())
            fields.setUTCDate(date.getUTCDate())
        })
    }

    /**
     * Gets or sets the week of the year in ISO time
     */
    public isoWeekYear(): number
    public isoWeekYear(value: number): Time
    public isoWeekYear(value?: number): number | Time {
        return this.#weekYear(ISO_WEEK, value)
    }

    /**
     * Gets the number of weeks of the year (weeks starting on Sunday)
     */
    public weeksInYear(): number {
        return WeeksInYear(this.#local().getUTCFullYear(), LOCALE_WEEK)
    }

    /**
     * Gets the number of ISO weeks of the year
     */
    public isoWeeksInYear(): number {
        return WeeksInYear(this.#local().getUTCFullYear(), ISO_WEEK)
    }

    /**
     * Universal getter (Depends on input unit)
     * @param unit
     */
    public get(unit: UnitOfTime.All): number {
        return this.#getSet(unit) as number
    }

    /**
     * Universal setter (Depends on input unit)
     * @param unit
     * @param value
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
     * Increase time
     * @param amount
     * @param unit
     */
    public add(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return this.#addDuration(amount, unit, 1)
    }

    /**
     * Minus time
     * @param amount
     * @param unit
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
                return LocalMilliseconds(year + next, 0, 1) - next
            case 'quarter':
                return LocalMilliseconds(year, month - (month % 3) + next * 3, 1) - next
            case 'month':
                return LocalMilliseconds(year, month + next, 1) - next
            case 'week':
                return LocalMilliseconds(year, month, date - (local.getUTCDay() + 7 - LOCALE_WEEK.dow) % 7 + next * 7) - next
            case 'isoWeek':
                return LocalMilliseconds(year, month, date - ((local.getUTCDay() || 7) - 1) + next * 7) - next
            case 'day':
            case 'date':
                return LocalMilliseconds(year, month, date + next) - next
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
     * Set to the start of a time unit
     * @param unit
     */
    public startOf(unit: UnitOfTime.StartOf): Time {
        const local: number | undefined = this.#boundary(unit, false)
        return local === undefined ? this.clone() : this.#atLocal(local)
    }

    /**
     * Set to the end of the time unit
     * @param unit
     */
    public endOf(unit: UnitOfTime.StartOf): Time {
        const local: number | undefined = this.#boundary(unit, true)
        return local === undefined ? this.clone() : this.#atLocal(local)
    }

    /**
     * Format output time string (default: YYYY-MM-DDTHH:mm:ssZ), with the format tokens of the moment library
     */
    public format(): string
    public format(format: string): string
    public format(format?: string): string {
        const instant: number = this.getTime()
        const offset: number = this.#offset()
        const context: FormatContext = {
            local: new Date(instant + offset * 60000),
            instant,
            offset,
            abbreviation: (): string => ZoneAbbreviation(this.#zone, instant)
        }
        //At an offset of zero, the default format ends with Z
        return FormatTime(format || (offset === 0 ? DEFAULT_UTC_FORMAT : DEFAULT_FORMAT), context)
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
     * Get time difference (truncated, unless precise)
     * @param inp
     * @param unit
     * @param precise
     */
    public diff(inp: TimeInput, unit?: UnitOfTime.Diff, precise?: boolean): number {
        const that: Time = this.#at(new Time(inp).getTime())
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
     * Outputs a Unix timestamp (number of seconds since the Unix epoch)
     */
    public unix(): number {
        return Math.floor(this.getTime() / 1000)
    }

    /**
     * Get the number of days in the current month
     */
    public daysInMonth(): number {
        const local: Date = this.#local()
        return DaysInMonth(local.getUTCFullYear(), local.getUTCMonth())
    }

    /**
     * This will return an array that reflects the parameters in new Date()
     */
    public toArray(): [number, number, number, number, number, number, number] {
        const local: Date = this.#local()
        return [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()]
    }

    /**
     * Returns an object containing the year, month, day of the month, hour, minute, second, and millisecond
     */
    public toObject(): TimeObject {
        const [years, months, date, hours, minutes, seconds, milliseconds] = this.toArray()
        return {years, months, date, hours, minutes, seconds, milliseconds}
    }

    /**
     * To string (like Fri Mar 01 2024 07:30:00 GMT+0800)
     */
    public toString(): string {
        return this.format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ')
    }

    /**
     * To time string, like Date (like 07:30:00 GMT+0800 (China Standard Time))
     */
    public toTimeString(): string {
        if (isNaN(this.getTime())) return 'Invalid Date'
        return `${this.format('HH:mm:ss [GMT]ZZ')} (${ZoneLongName(this.#zone, this.getTime())})`
    }

    /**
     * To date string
     */
    public toDateString(): string {
        return this.format('ddd MMM DD YYYY')
    }

    /**
     * Convert current time object to Date object
     */
    public toDate(): Date {
        return new Date(this.getTime())
    }

    /**
     * Is current time before input time
     * @param inp
     * @param granularity
     */
    public isBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        const input: number = new Time(inp).getTime()
        if (!normalizeUnit(granularity) || normalizeUnit(granularity) === 'millisecond') return this.getTime() < input
        return this.endOf(granularity!).getTime() < input
    }

    /**
     * Is current time same with input time
     * @param inp
     * @param granularity
     */
    public isSame(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        const input: number = new Time(inp).getTime()
        if (!normalizeUnit(granularity) || normalizeUnit(granularity) === 'millisecond') return this.getTime() === input
        return this.startOf(granularity!).getTime() <= input && input <= this.endOf(granularity!).getTime()
    }

    /**
     * Is current time after input time
     * @param inp
     * @param granularity
     */
    public isAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        const input: number = new Time(inp).getTime()
        if (!normalizeUnit(granularity) || normalizeUnit(granularity) === 'millisecond') return this.getTime() > input
        return input < this.startOf(granularity!).getTime()
    }

    /**
     * Is current time same or before input time
     * @param inp
     * @param granularity
     */
    public isSameOrBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.isSame(inp, granularity) || this.isBefore(inp, granularity)
    }

    /**
     * Is current time same or after input time
     * @param inp
     * @param granularity
     */
    public isSameOrAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.isSame(inp, granularity) || this.isAfter(inp, granularity)
    }

    /**
     * Is current time between two input times
     * @param a
     * @param b
     * @param granularity
     * @param inclusivity
     */
    public isBetween(a: TimeInput, b: TimeInput, granularity?: UnitOfTime.StartOf, inclusivity: '()' | '[)' | '(]' | '[]' = '()'): boolean {
        return (inclusivity[0] === '(' ? this.isAfter(a, granularity) : !this.isBefore(a, granularity)) &&
            (inclusivity[1] === ')' ? this.isBefore(b, granularity) : !this.isAfter(b, granularity))
    }

    /**
     * Check current time instance is leap year
     */
    public isLeapYear(): boolean {
        return IsLeapYear(this.#local().getUTCFullYear())
    }

    /**
     * Clone a time instance (same time, same time zone)
     */
    public clone(): Time {
        return this.#at(this.getTime())
    }
}
