import 'reflect-metadata'
import MomentTimezone from 'moment-timezone'
import {UnitOfTime} from './types/UnitOfTime.js'
import {TimeInput} from './types/TimeInput.js'
import {TimeObject} from './types/TimeObject.js'

export class Time extends Date {

    protected set __$$instance(instance: MomentTimezone.Moment) {
        Reflect.defineMetadata('__$$instance', instance, this)
    }

    protected get __$$instance(): MomentTimezone.Moment {
        return Reflect.getOwnMetadata('__$$instance', this)
    }

    constructor(inp?: TimeInput) {
        const __$$instance: MomentTimezone.Moment = inp ? (inp instanceof Time ? inp.__$$instance : process.env.TZ ? MomentTimezone(inp).tz(process.env.TZ) : MomentTimezone(inp)) : MomentTimezone()
        super(__$$instance.valueOf())
        this.__$$instance = __$$instance
    }

    public milliseconds(): number
    public milliseconds(value: number): Time
    public milliseconds(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.milliseconds(value).valueOf()) : this.__$$instance.milliseconds()
    }

    public seconds(): number
    public seconds(value: number): Time
    public seconds(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.seconds(value).valueOf()) : this.__$$instance.seconds()
    }

    public minutes(): number
    public minutes(value: number): Time
    public minutes(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.minutes(value).valueOf()) : this.__$$instance.minutes()
    }

    public hours(): number
    public hours(value: number): Time
    public hours(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.hours(value).valueOf()) : this.__$$instance.hours()
    }

    public date(): number
    public date(value: number): Time
    public date(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.date(value).valueOf()) : this.__$$instance.date()
    }

    public weekday(): number
    public weekday(value: number): Time
    public weekday(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.weekday(value).valueOf()) : this.__$$instance.weekday()
    }

    public isoWeekday(): number
    public isoWeekday(value: number): Time
    public isoWeekday(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.isoWeekday(value).valueOf()) : this.__$$instance.isoWeekday()
    }

    public dayOfYear(): number
    public dayOfYear(value: number): Time
    public dayOfYear(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.dayOfYear(value).valueOf()) : this.__$$instance.dayOfYear()
    }

    public weeks(): number
    public weeks(value: number): Time
    public weeks(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.weeks(value).valueOf()) : this.__$$instance.weeks()
    }

    public isoWeeks(): number
    public isoWeeks(value: number): Time
    public isoWeeks(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.isoWeeks(value).valueOf()) : this.__$$instance.isoWeeks()
    }

    public month(): number
    public month(value: number): Time
    public month(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.month(value).valueOf()) : this.__$$instance.month()
    }

    public quarters(): number
    public quarters(value: number): Time
    public quarters(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.quarters(value).valueOf()) : this.__$$instance.quarters()
    }

    public year(): number
    public year(value: number): Time
    public year(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.year(value).valueOf()) : this.__$$instance.year()
    }

    public isoWeekYear(): number
    public isoWeekYear(value: number): Time
    public isoWeekYear(value?: number): number | Time {
        return value !== undefined ? new Time(this.__$$instance.isoWeekYear(value).valueOf()) : this.__$$instance.isoWeekYear()
    }

    public weeksInYear(): number {
        return this.__$$instance.weeksInYear()
    }

    public isoWeeksInYear(): number {
        return this.__$$instance.weeksInYear()
    }

    public get(unit: UnitOfTime.All): number {
        return this.__$$instance.get(unit)
    }

    public set(unit: UnitOfTime.All, value: number): Time {
        return new Time(this.__$$instance.set(unit, value).valueOf())
    }

    public static max(...times: Time[]): Time {
        if (!times.length) return new Time()
        const maxMap: Map<MomentTimezone.Moment, Time> = new Map()
        times.forEach(time => maxMap.set(time.__$$instance, time))
        return maxMap.get(MomentTimezone.max(...maxMap.keys()))!
    }

    public static min(...times: Time[]): Time {
        if (!times.length) return new Time()
        const minMap: Map<MomentTimezone.Moment, Time> = new Map()
        times.forEach(time => minMap.set(time.__$$instance, time))
        return minMap.get(MomentTimezone.min(...minMap.keys()))!
    }

    public add(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return new Time(this.__$$instance.add(amount, unit).valueOf())
    }

    public subtract(amount: number, unit: UnitOfTime.DurationConstructor): Time {
        return new Time(this.__$$instance.subtract(amount, unit).valueOf())
    }

    public startOf(unit: UnitOfTime.StartOf): Time {
        return new Time(this.__$$instance.startOf(unit).valueOf())
    }

    public endOf(unit: UnitOfTime.StartOf): Time {
        return new Time(this.__$$instance.endOf(unit).valueOf())
    }

    public format(): string
    public format(format: string): string
    public format(format?: string): string {
        return this.__$$instance.format(format)
    }

    public diff(inp: TimeInput, unit?: UnitOfTime.Diff, precise?: boolean): number {
        return this.__$$instance.diff(new Time(inp).__$$instance, unit, precise)
    }

    public unix(): number {
        this.valueOf()
        return this.__$$instance.unix()
    }

    public daysInMonth(): number {
        return this.__$$instance.daysInMonth()
    }

    public toArray(): [number, number, number, number, number, number, number] {
        return this.__$$instance.toArray()
    }

    public toObject(): TimeObject {
        return this.__$$instance.toObject()
    }

    public isBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isBefore(new Time(inp).__$$instance, granularity)
    }

    public isSame(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isSame(new Time(inp).__$$instance, granularity)
    }

    public isAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isAfter(new Time(inp).__$$instance, granularity)
    }

    public isSameOrBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isSameOrBefore(new Time(inp).__$$instance, granularity)
    }

    public isSameOrAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isSameOrAfter(new Time(inp).__$$instance, granularity)
    }

    public isBetween(a: TimeInput, b: TimeInput, granularity?: UnitOfTime.StartOf, inclusivity?: '()' | '[)' | '(]' | '[]'): boolean {
        return this.__$$instance.isBetween(new Time(a).__$$instance, new Time(b).__$$instance, granularity, inclusivity)
    }

    public isLeapYear(): boolean {
        return this.__$$instance.isLeapYear()
    }

}
