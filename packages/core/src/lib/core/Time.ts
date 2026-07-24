import 'reflect-metadata'
import MomentTimezone from 'moment-timezone'
import {DTO} from './DTO.js'

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
 * Time class
 */
export class Time extends Date {

    /**
     * Moment instance
     * @private
     */
    #instance: MomentTimezone.Moment

    /**
     * Constructor
     * @param inp
     */
    constructor(inp?: TimeInput) {
        if (inp && typeof inp === 'string') inp = DTO.validate(inp, DTO.Date().strict(false))
        const instance: MomentTimezone.Moment = inp
            ? (inp instanceof Time && inp.#instance
                ? MomentTimezone(inp.#instance)
                : process.env.TZ
                    ? MomentTimezone(inp).tz(process.env.TZ)
                    : MomentTimezone(inp))
            : MomentTimezone().tz(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone)
        super(instance.valueOf())
        this.#instance = instance
    }

    /**
     * Get all timezone names
     */
    public static timezones(): string[] {
        return MomentTimezone.tz.names()
    }

    /**
     * Returns the maximum value for a given instance (farthest into the future)
     * @param times
     */
    public static max(...times: Time[]): Time {
        if (!times.length) return new Time()
        const maxMap: Map<MomentTimezone.Moment, Time> = new Map()
        times.forEach(time => maxMap.set(time.#instance, time))
        return maxMap.get(MomentTimezone.max(...maxMap.keys()))!
    }

    /**
     * Returns the minimum value (most distant past) of the given instance
     * @param times
     */
    public static min(...times: Time[]): Time {
        if (!times.length) return new Time()
        const minMap: Map<MomentTimezone.Moment, Time> = new Map()
        times.forEach(time => minMap.set(time.#instance, time))
        return minMap.get(MomentTimezone.min(...minMap.keys()))!
    }

    /**
     * Update the current instance internal timestamp and return new Time instance
     * @param time
     * @protected
     */
    protected updateTimestampWithNewTime(time: number): Time {
        const newInstance: Time = new Time(time)
        const tz: string | undefined = this.tz()
        if (tz) newInstance.tz(tz)
        return newInstance
    }

    /**
     * Internal get or set time zone
     * @protected
     */
    protected tz(): string | undefined
    protected tz(tz: string): this
    protected tz(tz?: string): string | undefined | this {
        if (tz) {
            this.#instance = this.#instance.tz(tz)
            return this
        } else {
            return this.#instance.tz()
        }
    }

    /**
     * Get time zone offset
     */
    public getTimezoneOffset(): number {
        return this.#instance.utcOffset()
    }

    /**
     * Get or set time zone
     */
    public timezone(): string | undefined
    public timezone(tz: string): Time
    public timezone(tz?: string): string | undefined | Time {
        if (tz) {
            return new Time(this.getTime()).tz(tz)
        } else {
            return this.tz()
        }
    }

    /**
     * Get or set the number of milliseconds
     */
    public milliseconds(): number
    public milliseconds(value: number): Time
    public milliseconds(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().milliseconds(value).valueOf()) : this.#instance.milliseconds()
    }

    /**
     * Get or set seconds
     */
    public seconds(): number
    public seconds(value: number): Time
    public seconds(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().seconds(value).valueOf()) : this.#instance.seconds()
    }

    /**
     * Get or set minutes
     */
    public minutes(): number
    public minutes(value: number): Time
    public minutes(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().minutes(value).valueOf()) : this.#instance.minutes()
    }

    /**
     * Get or set the hour
     */
    public hours(): number
    public hours(value: number): Time
    public hours(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().hours(value).valueOf()) : this.#instance.hours()
    }

    /**
     * Get or set the day of the month
     * Accepts numbers from 1 to 31. If out of range it will bubble up to months
     */
    public date(): number
    public date(value: number): Time
    public date(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().date(value).valueOf()) : this.#instance.date()
    }

    /**
     * Set to get or set the day of the week
     */
    public weekday(): number
    public weekday(value: number): Time
    public weekday(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().weekday(value).valueOf()) : this.#instance.weekday()
    }

    /**
     * Get or set the ISO day of the week, 1 is Monday, 7 is Sunday
     */
    public isoWeekday(): number
    public isoWeekday(value: number): Time
    public isoWeekday(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().isoWeekday(value).valueOf()) : this.#instance.isoWeekday()
    }

    /**
     * Get or set the day of the year
     * Accepts numbers from 1 to 366. If out of range it will bubble up to the year
     */
    public dayOfYear(): number
    public dayOfYear(value: number): Time
    public dayOfYear(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().dayOfYear(value).valueOf()) : this.#instance.dayOfYear()
    }

    /**
     * Gets or sets the week of the year
     */
    public weeks(): number
    public weeks(value: number): Time
    public weeks(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().weeks(value).valueOf()) : this.#instance.weeks()
    }

    /**
     * Gets or sets the ISO week of the year
     */
    public isoWeeks(): number
    public isoWeeks(value: number): Time
    public isoWeeks(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().isoWeeks(value).valueOf()) : this.#instance.isoWeeks()
    }

    /**
     * Get or set the month
     * Accepts numbers from 0 to 11. If out of range it will bubble up to the year
     */
    public month(): number
    public month(value: number): Time
    public month(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().month(value).valueOf()) : this.#instance.month()
    }

    /**
     * Gets or sets the quarter (1 to 4)
     */
    public quarters(): number
    public quarters(value: number): Time
    public quarters(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().quarters(value).valueOf()) : this.#instance.quarters()
    }

    /**
     * Get or set the year
     * Accepts numbers from -270,000 to 270,000
     */
    public year(): number
    public year(value: number): Time
    public year(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().year(value).valueOf()) : this.#instance.year()
    }

    /**
     * Gets or sets the week of the year in ISO time
     */
    public isoWeekYear(): number
    public isoWeekYear(value: number): Time
    public isoWeekYear(value?: number): number | Time {
        return value !== undefined ? this.updateTimestampWithNewTime(this.#instance.clone().isoWeekYear(value).valueOf()) : this.#instance.isoWeekYear()
    }

    /**
     * Gets the week number based on the locale of the current instance's year
     */
    public weeksInYear(): number {
        return this.#instance.weeksInYear()
    }

    /**
     * Get the week number of the year where the current instance is located based on the week number
     */
    public isoWeeksInYear(): number {
        return this.#instance.weeksInYear()
    }

    /**
     * Universal getter (Depends on input unit)
     * @param unit
     */
    public get(unit: UnitOfTime.All): number {
        return this.#instance.get(unit)
    }

    /**
     * Universal setter (Depends on input unit)
     * @param unit
     * @param value
     */
    public set(unit: UnitOfTime.All, value: number): Time {
        return this.updateTimestampWithNewTime(this.#instance.clone().set(unit, value).valueOf())
    }

    /**
     * Increase time
     * @param amount
     * @param unit
     */
    public add(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return this.updateTimestampWithNewTime(this.#instance.clone().add(amount, unit).valueOf())
    }

    /**
     * Minus time
     * @param amount
     * @param unit
     */
    public subtract(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return this.updateTimestampWithNewTime(this.#instance.clone().subtract(amount, unit).valueOf())
    }

    /**
     * Set to the start of a time unit
     * @param unit
     */
    public startOf(unit: UnitOfTime.StartOf): Time {
        return this.updateTimestampWithNewTime(this.#instance.clone().startOf(unit).valueOf())
    }

    /**
     * Set to the end of the time unit
     * @param unit
     */
    public endOf(unit: UnitOfTime.StartOf): Time {
        return this.updateTimestampWithNewTime(this.#instance.clone().endOf(unit).valueOf())
    }

    /**
     * Format output time string
     */
    public format(): string
    public format(format: string): string
    public format(format?: string): string {
        return this.#instance.format(format)
    }

    /**
     * Get time difference
     * @param inp
     * @param unit
     * @param precise
     */
    public diff(inp: TimeInput, unit?: UnitOfTime.Diff, precise?: boolean): number {
        return this.#instance.diff(new Time(inp).#instance, unit, precise)
    }

    /**
     * Outputs a Unix timestamp (number of seconds since the Unix epoch)
     */
    public unix(): number {
        this.valueOf()
        return this.#instance.unix()
    }

    /**
     * Get the number of days in the current month
     */
    public daysInMonth(): number {
        return this.#instance.daysInMonth()
    }

    /**
     * This will return an array that reflects the parameters in new Date()
     */
    public toArray(): [number, number, number, number, number, number, number] {
        return this.#instance.toArray()
    }

    /**
     * Returns an object containing the year, month, day of the month, hour, minute, second, and millisecond
     */
    public toObject(): TimeObject {
        return this.#instance.toObject()
    }

    /**
     * To string
     */
    public toString(): string {
        return this.#instance.toString()
    }

    /**
     * To time string
     */
    public toTimeString(): string {
        return this.#instance.toString()
    }

    /**
     * To UTC string
     */
    public toUTCString(): string {
        return this.#instance.toISOString(true)
    }

    /**
     * To date string
     */
    public toDateString(): string {
        return this.#instance.format('ddd MMM DD YYYY')
    }

    /**
     * Return ISO format time string
     */
    public toISOString(): string {
        return this.#instance.toISOString()
    }

    /**
     * Convert current time object to Date object
     */
    public toDate(): Date {
        return this.#instance.toDate()
    }

    /**
     * Is current time before input time
     * @param inp
     * @param granularity
     */
    public isBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.#instance.isBefore(new Time(inp).#instance, granularity)
    }

    /**
     * Is current time same with input time
     * @param inp
     * @param granularity
     */
    public isSame(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.#instance.isSame(new Time(inp).#instance, granularity)
    }

    /**
     * Is current time after input time
     * @param inp
     * @param granularity
     */
    public isAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.#instance.isAfter(new Time(inp).#instance, granularity)
    }

    /**
     * Is current time same or before input time
     * @param inp
     * @param granularity
     */
    public isSameOrBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.#instance.isSameOrBefore(new Time(inp).#instance, granularity)
    }

    /**
     * Is current time same or after input time
     * @param inp
     * @param granularity
     */
    public isSameOrAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.#instance.isSameOrAfter(new Time(inp).#instance, granularity)
    }

    /**
     * Is current time between two input times
     * @param a
     * @param b
     * @param granularity
     * @param inclusivity
     */
    public isBetween(a: TimeInput, b: TimeInput, granularity?: UnitOfTime.StartOf, inclusivity?: '()' | '[)' | '(]' | '[]'): boolean {
        return this.#instance.isBetween(new Time(a).#instance, new Time(b).#instance, granularity, inclusivity)
    }

    /**
     * Check current time instance is leap year
     */
    public isLeapYear(): boolean {
        return this.#instance.isLeapYear()
    }

    /**
     * Clone a time instance
     */
    public clone(): Time {
        return new Time(this.#instance.clone().valueOf())
    }
}
