/**
 * The wall clock time of an instant
 */
type WallClock = {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
    weekday: number
}

/**
 * A field of an expression: its values and whether it is restricted (not "*")
 */
type Field = {
    values: Set<number>
    restricted: boolean
}

const MONTHS: string[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const WEEKDAYS: string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const MACROS: Record<string, string> = {
    '@yearly': '0 0 0 1 1 *',
    '@annually': '0 0 0 1 1 *',
    '@monthly': '0 0 0 1 * *',
    '@weekly': '0 0 0 * * 0',
    '@daily': '0 0 0 * * *',
    '@midnight': '0 0 0 * * *',
    '@hourly': '0 0 * * * *'
}

/**
 * The formatters of the time zones
 */
const formatters: Map<string, Intl.DateTimeFormat> = new Map()

/**
 * The wall clock time of an instant, in a time zone or in the local time
 * @param time
 * @param timezone
 */
function wallClock(time: number, timezone?: string): WallClock {
    if (!timezone) {
        const date: Date = new Date(time)
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            hour: date.getHours(),
            minute: date.getMinutes(),
            second: date.getSeconds(),
            weekday: date.getDay()
        }
    }
    let formatter: Intl.DateTimeFormat | undefined = formatters.get(timezone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            weekday: 'short'
        })
        formatters.set(timezone, formatter)
    }
    const parts: Record<string, string> = {}
    for (const part of formatter.formatToParts(new Date(time))) parts[part.type] = part.value
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
        weekday: WEEKDAYS.indexOf(parts.weekday.toLowerCase())
    }
}

/**
 * A wall clock time as a number, to compare them
 * @param clock
 */
function wallKey(clock: WallClock): number {
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
}

/**
 * The instant of a wall clock time (the overflowing fields carry over), in a time zone or in the local time
 * @param year
 * @param month
 * @param day
 * @param hour
 * @param minute
 * @param second
 * @param timezone
 */
function instant(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone?: string): number {
    if (!timezone) return new Date(year, month - 1, day, hour, minute, second).getTime()
    const wall: number = Date.UTC(year, month - 1, day, hour, minute, second)
    //The offset of the time zone at the instant, found again at the corrected instant (the offset changes with the daylight saving time)
    let time: number = wall
    for (let pass: number = 0; pass < 2; pass++) {
        const clock: WallClock = wallClock(time, timezone)
        const offset: number = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - time
        time = wall - offset
    }
    return time
}

/**
 * Parse a field of an expression
 * @param text
 * @param min
 * @param max
 * @param names the names of the values from min
 * @param expression
 */
function parseField(text: string, min: number, max: number, names: string[] | undefined, expression: string): Field {
    const invalid = (reason: string): Error => new SyntaxError(`Invalid cron expression "${expression}": ${reason}`)
    const value = (item: string): number => {
        const index: number = names ? names.indexOf(item.toLowerCase()) : -1
        const parsed: number = index >= 0 ? index + min : /^\d+$/.test(item) ? Number(item) : NaN
        if (Number.isNaN(parsed) || parsed < min || parsed > max) throw invalid(`"${item}" is not a value from ${min} to ${max}`)
        return parsed
    }
    const values: Set<number> = new Set()
    const restricted: boolean = text !== '*' && text !== '?'
    for (const item of text.split(',')) {
        const [range, stepText] = item.split('/')
        const step: number = stepText === undefined ? 1 : Number(stepText)
        if (!Number.isInteger(step) || step < 1) throw invalid(`"${stepText}" is not a step`)
        let start: number = min
        let end: number = max
        if (range !== '*' && range !== '?') {
            const [from, to] = range.split('-')
            start = value(from)
            end = to === undefined ? (stepText === undefined ? start : max) : value(to)
            if (end < start) throw invalid(`the range "${range}" is reversed`)
        }
        for (let current: number = start; current <= end; current += step) values.add(current)
    }
    return {values: values, restricted: restricted}
}

/**
 * A cron expression, as `@Schedule` uses it: `second minute hour day-of-month month day-of-week`, the second optional
 * (0 when omitted). Each field accepts `*` (or `?`), values, ranges (`1-5`), steps (`*\/15`, `10/5`, `1-30/2`) and lists
 * (`1,15`); the months and the days of the week also accept their English three-letter names (`jan`, `mon`), and the
 * day of the week 7 is Sunday like 0. The macros `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`
 * and `@hourly` are accepted. When both the day of the month and the day of the week are restricted, a day matching
 * either of them matches.
 * @example
 * ```typescript
 * import {Cron} from 'lakutata/com/entrypoint'
 *
 * //At 09:30 on the weekdays, in Shanghai
 * const cron: Cron = new Cron('30 9 * * mon-fri', 'Asia/Shanghai')
 * const next: Date | undefined = cron.next(new Date('2026-01-02T12:00:00Z'))
 * console.log(next?.toISOString()) //2026-01-05T01:30:00.000Z
 * console.log(new Cron('0 0 30 2 *').next()) //undefined: February has no 30th
 * ```
 */
export class Cron {

    readonly #second: Field

    readonly #minute: Field

    readonly #hour: Field

    readonly #day: Field

    readonly #month: Field

    readonly #weekday: Field

    /**
     * Parse a cron expression.
     * @param expression The expression, 5 or 6 fields separated by spaces, or a macro (case-insensitive).
     * @param timezone The IANA time zone the expression's times are in (`Asia/Shanghai`); the local time zone when
     * omitted.
     * @throws {SyntaxError} When the expression does not have 5 or 6 fields, or a field has a value out of its range,
     * a reversed range or an invalid step.
     * @throws {RangeError} When the time zone is unknown.
     */
    constructor(public readonly expression: string, public readonly timezone?: string) {
        if (timezone) new Intl.DateTimeFormat('en-US', {timeZone: timezone})
        const normalized: string = expression.trim().toLowerCase()
        const fields: string[] = (MACROS[normalized] ?? normalized).split(/\s+/)
        if (fields.length === 5) fields.unshift('0')
        if (fields.length !== 6) throw new SyntaxError(`Invalid cron expression "${expression}": 5 or 6 fields are expected`)
        this.#second = parseField(fields[0], 0, 59, undefined, expression)
        this.#minute = parseField(fields[1], 0, 59, undefined, expression)
        this.#hour = parseField(fields[2], 0, 23, undefined, expression)
        this.#day = parseField(fields[3], 1, 31, undefined, expression)
        this.#month = parseField(fields[4], 1, 12, MONTHS, expression)
        const weekday: Field = parseField(fields[5], 0, 7, WEEKDAYS, expression)
        //7 is Sunday too
        if (weekday.values.delete(7)) weekday.values.add(0)
        this.#weekday = weekday
    }

    /**
     * Whether a day matches
     * @param clock
     */
    #dayMatches(clock: WallClock): boolean {
        const day: boolean = this.#day.values.has(clock.day)
        const weekday: boolean = this.#weekday.values.has(clock.weekday)
        if (this.#day.restricted && this.#weekday.restricted) return day || weekday
        return day && weekday
    }

    /**
     * Find the next time matching the expression, strictly after a time, to the second. When the clocks go back, the
     * times of the repeated hour match once; the times skipped when the clocks go forward never match.
     * @param after The time to search from, a date or milliseconds since the epoch; now by default.
     * @returns The next matching time, `undefined` when none matches within eight years (such as February 30th).
     */
    public next(after: Date | number = Date.now()): Date | undefined {
        const timezone: string | undefined = this.timezone
        const start: number = Math.floor(new Date(after).getTime() / 1000) * 1000
        //When the clocks go back, the times of the repeated hour match once
        const afterKey: number = wallKey(wallClock(start, timezone))
        let time: number = start + 1000
        //Eight years of candidates at most: a leap day on a weekday comes back within them
        const limit: number = time + 8 * 366 * 24 * 3600 * 1000
        while (time < limit) {
            const clock: WallClock = wallClock(time, timezone)
            let candidate: number | undefined
            if (!this.#month.values.has(clock.month)) {
                candidate = instant(clock.year, clock.month + 1, 1, 0, 0, 0, timezone)
            } else if (!this.#dayMatches(clock)) {
                candidate = instant(clock.year, clock.month, clock.day + 1, 0, 0, 0, timezone)
            } else if (!this.#hour.values.has(clock.hour)) {
                candidate = instant(clock.year, clock.month, clock.day, clock.hour + 1, 0, 0, timezone)
            } else if (!this.#minute.values.has(clock.minute)) {
                candidate = instant(clock.year, clock.month, clock.day, clock.hour, clock.minute + 1, 0, timezone)
            } else if (!this.#second.values.has(clock.second)) {
                candidate = instant(clock.year, clock.month, clock.day, clock.hour, clock.minute, clock.second + 1, timezone)
            } else if (wallKey(clock) <= afterKey) {
                candidate = time + (afterKey - wallKey(clock)) + 1000
            } else {
                return new Date(time)
            }
            //A time skipped by the daylight saving time may map back: the search always moves forward
            time = candidate > time ? candidate : time + 1000
        }
        return undefined
    }
}

/**
 * Parse a duration into milliseconds, as `@Schedule` reads its intervals.
 * @param duration A number of milliseconds, or a text of numbers with their units (`ms`, `s`, `m`, `h`, `d`), summed
 * and case-insensitive: `500ms`, `30s`, `1.5h`, `1h 30m`, `1d`.
 * @returns The duration in milliseconds.
 * @throws {SyntaxError} When the duration is not positive (or not finite), or the text has an unknown part.
 * @example
 * ```typescript
 * import {parseDuration} from 'lakutata/com/entrypoint'
 *
 * console.log(parseDuration('1h30m')) //5400000
 * console.log(parseDuration('500ms')) //500
 * console.log(parseDuration(2000)) //2000
 * ```
 */
export function parseDuration(duration: number | string): number {
    if (typeof duration === 'number') {
        if (!Number.isFinite(duration) || duration <= 0) throw new SyntaxError(`Invalid duration ${duration}: a positive number of milliseconds is expected`)
        return duration
    }
    const units: Record<string, number> = {ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000}
    const text: string = duration.trim().toLowerCase()
    let total: number = 0
    let rest: string = text
    const part: RegExp = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)/
    while (rest) {
        const matched: RegExpExecArray | null = part.exec(rest)
        if (!matched) throw new SyntaxError(`Invalid duration "${duration}": such as "500ms", "30s", "5m", "1h30m" or "1d"`)
        total += Number(matched[1]) * units[matched[2]]
        rest = rest.slice(matched[0].length).trim()
    }
    if (total <= 0) throw new SyntaxError(`Invalid duration "${duration}": it must be positive`)
    return total
}
