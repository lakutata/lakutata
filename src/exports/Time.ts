import 'reflect-metadata'
import MomentTimezone from 'moment-timezone'
import {UnitOfTime} from '../types/UnitOfTime.js'
import {TimeInput} from '../types/TimeInput.js'
import {TimeObject} from '../types/TimeObject.js'

export class Time extends Date {

    protected set __$$instance(instance: MomentTimezone.Moment) {
        Reflect.defineMetadata('__$$instance', instance, this)
    }

    protected get __$$instance(): MomentTimezone.Moment {
        return Reflect.getOwnMetadata('__$$instance', this)
    }

    constructor(inp?: TimeInput) {
        const __$$instance: MomentTimezone.Moment = inp ? (inp instanceof Time ? MomentTimezone(inp.__$$instance) : process.env.TZ ? MomentTimezone(inp).tz(process.env.TZ) : MomentTimezone(inp)) : MomentTimezone()
        super(__$$instance.valueOf())
        this.__$$instance = __$$instance
    }

    /**
     * 获取所有时区名称数组
     */
    public static timezones(): string[] {
        return MomentTimezone.tz.names()
    }

    /**
     * 返回给定实例的最大值（最遥远的未来）
     * @param times
     */
    public static max(...times: Time[]): Time {
        if (!times.length) return new Time()
        const maxMap: Map<MomentTimezone.Moment, Time> = new Map()
        times.forEach(time => maxMap.set(time.__$$instance, time))
        return maxMap.get(MomentTimezone.max(...maxMap.keys()))!
    }

    /**
     * 返回给定实例的最小值（最遥远的过去）
     * @param times
     */
    public static min(...times: Time[]): Time {
        if (!times.length) return new Time()
        const minMap: Map<MomentTimezone.Moment, Time> = new Map()
        times.forEach(time => minMap.set(time.__$$instance, time))
        return minMap.get(MomentTimezone.min(...minMap.keys()))!
    }

    /**
     * 更新当前实例内部时间戳并返回当前实例
     * @param time
     * @protected
     */
    protected updateTimestamp(time: number): this {
        this.setTime(time)
        return this
    }

    /**
     * 获取时区偏移量
     */
    public getTimezoneOffset(): number {
        return this.__$$instance.utcOffset()
    }

    /**
     * 获取或设置时区
     */
    public timezone(): string | undefined
    public timezone(tz: string): this
    public timezone(tz?: string): string | undefined | this {
        if (tz) {
            this.__$$instance = this.__$$instance.tz(tz)
            return this
        } else {
            return this.__$$instance.tz()
        }
    }

    /**
     * 获取或设置毫秒数
     */
    public milliseconds(): number
    public milliseconds(value: number): this
    public milliseconds(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.milliseconds(value).valueOf()) : this.__$$instance.milliseconds()
    }

    /**
     * 获取或设置秒数
     */
    public seconds(): number
    public seconds(value: number): this
    public seconds(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.seconds(value).valueOf()) : this.__$$instance.seconds()
    }

    /**
     * 获取或设置分钟
     */
    public minutes(): number
    public minutes(value: number): this
    public minutes(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.minutes(value).valueOf()) : this.__$$instance.minutes()
    }

    /**
     * 获取或设置小时
     */
    public hours(): number
    public hours(value: number): this
    public hours(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.hours(value).valueOf()) : this.__$$instance.hours()
    }

    /**
     * 获取或设置月中的第几天
     * 接受从 1 到 31 的数字。 如果超出范围，它将冒泡到几个月
     */
    public date(): number
    public date(value: number): this
    public date(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.date(value).valueOf()) : this.__$$instance.date()
    }

    /**
     * 设置获取或设置星期几
     */
    public weekday(): number
    public weekday(value: number): this
    public weekday(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.weekday(value).valueOf()) : this.__$$instance.weekday()
    }

    /**
     * 获取或设置 ISO 星期，1 为星期一，7 为星期日
     */
    public isoWeekday(): number
    public isoWeekday(value: number): this
    public isoWeekday(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.isoWeekday(value).valueOf()) : this.__$$instance.isoWeekday()
    }

    /**
     * 获取或设置一年中的第几天
     * 接受从 1 到 366 的数字。 如果超出范围，它将冒泡到年份
     */
    public dayOfYear(): number
    public dayOfYear(value: number): this
    public dayOfYear(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.dayOfYear(value).valueOf()) : this.__$$instance.dayOfYear()
    }

    /**
     * 获取或设置一年中的第几周
     */
    public weeks(): number
    public weeks(value: number): this
    public weeks(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.weeks(value).valueOf()) : this.__$$instance.weeks()
    }

    /**
     * 获取或设置一年中的ISO周
     */
    public isoWeeks(): number
    public isoWeeks(value: number): this
    public isoWeeks(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.isoWeeks(value).valueOf()) : this.__$$instance.isoWeeks()
    }

    /**
     * 获取或设置月份
     * 接受从 0 到 11 的数字。 如果超出范围，它将冒泡到年份
     */
    public month(): number
    public month(value: number): this
    public month(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.month(value).valueOf()) : this.__$$instance.month()
    }

    /**
     * 获取或设置月份（1 到 4）
     */
    public quarters(): number
    public quarters(value: number): this
    public quarters(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.quarters(value).valueOf()) : this.__$$instance.quarters()
    }

    /**
     * 获取或设置年份
     * 接受从 -270,000 到 270,000 的数字
     */
    public year(): number
    public year(value: number): this
    public year(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.year(value).valueOf()) : this.__$$instance.year()
    }

    /**
     * 获取或设置ISO周年
     */
    public isoWeekYear(): number
    public isoWeekYear(value: number): this
    public isoWeekYear(value?: number): number | this {
        return value !== undefined ? this.updateTimestamp(this.__$$instance.isoWeekYear(value).valueOf()) : this.__$$instance.isoWeekYear()
    }

    /**
     * 根据当前实例所在年份的区域设置获取周数
     */
    public weeksInYear(): number {
        return this.__$$instance.weeksInYear()
    }

    /**
     * 根据周数，获取当前实例所在年份的周数
     */
    public isoWeeksInYear(): number {
        return this.__$$instance.weeksInYear()
    }

    /**
     * 通用获取器
     * @param unit
     */
    public get(unit: UnitOfTime.All): number {
        return this.__$$instance.get(unit)
    }

    /**
     * 通用设置器
     * @param unit
     * @param value
     */
    public set(unit: UnitOfTime.All, value: number): this {
        return this.updateTimestamp(this.__$$instance.set(unit, value).valueOf())
    }

    /**
     * 增加时间
     * @param amount
     * @param unit
     */
    public add(amount: number, unit: UnitOfTime.DurationConstructor): this {
        return this.updateTimestamp(this.__$$instance.add(amount, unit).valueOf())
    }

    /**
     * 减去时间
     * @param amount
     * @param unit
     */
    public subtract(amount: number, unit: UnitOfTime.DurationConstructor): this {
        return this.updateTimestamp(this.__$$instance.subtract(amount, unit).valueOf())
    }

    /**
     * 设置为一个时间单位的开始
     * @param unit
     */
    public startOf(unit: UnitOfTime.StartOf): this {
        return this.updateTimestamp(this.__$$instance.startOf(unit).valueOf())
    }

    /**
     * 设置为时间单位的末尾
     * @param unit
     */
    public endOf(unit: UnitOfTime.StartOf): this {
        return this.updateTimestamp(this.__$$instance.endOf(unit).valueOf())
    }

    /**
     * 格式化输出时间字符串
     */
    public format(): string
    public format(format: string): string
    public format(format?: string): string {
        return this.__$$instance.format(format)
    }

    /**
     * 获取时间差
     * @param inp
     * @param unit
     * @param precise
     */
    public diff(inp: TimeInput, unit?: UnitOfTime.Diff, precise?: boolean): number {
        return this.__$$instance.diff(new Time(inp).__$$instance, unit, precise)
    }

    /**
     * 输出一个 Unix 时间戳（自 Unix 纪元以来的秒数）
     */
    public unix(): number {
        this.valueOf()
        return this.__$$instance.unix()
    }

    /**
     * 获取当月的天数
     */
    public daysInMonth(): number {
        return this.__$$instance.daysInMonth()
    }

    /**
     * 这将返回一个数组，该数组反映了 new Date() 中的参数
     */
    public toArray(): [number, number, number, number, number, number, number] {
        return this.__$$instance.toArray()
    }

    /**
     * 返回一个包含年、月、月中某日、小时、分钟、秒、毫秒的对象
     */
    public toObject(): TimeObject {
        return this.__$$instance.toObject()
    }

    /**
     * 返回时间对象的字符串
     */
    public toString(): string {
        return this.__$$instance.toString()
    }

    public toTimeString(): string {
        return this.__$$instance.toString()
    }

    public toUTCString(): string {
        return this.__$$instance.toISOString(true)
    }

    public toDateString(): string {
        return this.__$$instance.format('ddd MMM DD YYYY')
    }

    /**
     * 返回时间对象的ISO格式字符串
     */
    public toISOString(): string {
        return this.__$$instance.toISOString()
    }

    /**
     * 检查一个时间是否在另一个时间之前
     * @param inp
     * @param granularity
     */
    public isBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isBefore(new Time(inp).__$$instance, granularity)
    }

    /**
     * 检查一个时间是否与另一个时间相同
     * @param inp
     * @param granularity
     */
    public isSame(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isSame(new Time(inp).__$$instance, granularity)
    }

    /**
     * 检查一个时间是否在另一个时间之后
     * @param inp
     * @param granularity
     */
    public isAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isAfter(new Time(inp).__$$instance, granularity)
    }

    /**
     * 检查一个时间是否在另一个时间之前或与另一个时间相同
     * @param inp
     * @param granularity
     */
    public isSameOrBefore(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isSameOrBefore(new Time(inp).__$$instance, granularity)
    }

    /**
     * 检查一个时间是否在另一个时间之后或与另一个时间相同
     * @param inp
     * @param granularity
     */
    public isSameOrAfter(inp?: TimeInput, granularity?: UnitOfTime.StartOf): boolean {
        return this.__$$instance.isSameOrAfter(new Time(inp).__$$instance, granularity)
    }

    /**
     * 检查一个时间是否在其他两个时间之间
     * @param a
     * @param b
     * @param granularity
     * @param inclusivity
     */
    public isBetween(a: TimeInput, b: TimeInput, granularity?: UnitOfTime.StartOf, inclusivity?: '()' | '[)' | '(]' | '[]'): boolean {
        return this.__$$instance.isBetween(new Time(a).__$$instance, new Time(b).__$$instance, granularity, inclusivity)
    }

    /**
     * 检查该实例的年份是否闰年
     */
    public isLeapYear(): boolean {
        return this.__$$instance.isLeapYear()
    }

    /**
     * 克隆一个时间实例
     */
    public clone(): Time {
        return new Time(this.__$$instance.clone().valueOf())
    }
}
