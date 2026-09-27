/**
 * The time zones: their offsets from UTC at an instant, read from the time zone data of the runtime (Intl)
 */

/**
 * The formatters giving the wall clock fields of an instant in a time zone, by time zone
 */
const fieldFormatters: Map<string, Intl.DateTimeFormat> = new Map()

/**
 * The offsets (minutes) of recent computations, by time zone then by quarter of an hour (the transitions of the time
 * zones since 1970 happen at quarter hours)
 */
const offsetCache: Map<string, Map<number, number>> = new Map()

const QUARTER_HOUR: number = 15 * 60 * 1000
const MAX_CACHED_OFFSETS: number = 4096

/**
 * The time zone of the process: the TZ environment variable, else the time zone of the system (read once)
 */
let systemZone: string | undefined

/**
 * The default time zone: the TZ environment variable, else the time zone of the system
 */
export function DefaultZone(): string {
    const tz: string | undefined = process.env.TZ
    if (tz) return tz
    if (systemZone === undefined) systemZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    return systemZone
}

/**
 * The names of the time zones the runtime supports
 */
export function ZoneNames(): string[] {
    return Intl.supportedValuesOf('timeZone')
}

/**
 * The formatter of the wall clock fields of a time zone
 * @param zone
 * @throws RangeError when the time zone is not supported
 */
function fieldFormatter(zone: string): Intl.DateTimeFormat {
    let formatter: Intl.DateTimeFormat | undefined = fieldFormatters.get(zone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            hourCycle: 'h23',
            era: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        })
        fieldFormatters.set(zone, formatter)
    }
    return formatter
}

/**
 * Validates a time zone name
 * @param zone
 * @throws RangeError when the time zone is not supported
 */
export function AssertZone(zone: string): void {
    try {
        fieldFormatter(zone)
    } catch {
        throw new RangeError(`Invalid time zone: ${zone}`)
    }
}

/**
 * The offset from UTC of a time zone at an instant, in minutes (positive east of Greenwich)
 * @param zone
 * @param instant milliseconds since the epoch
 */
export function OffsetAt(zone: string, instant: number): number {
    if (isNaN(instant)) return NaN
    const cacheable: boolean = instant >= 0
    const bucket: number = Math.floor(instant / QUARTER_HOUR)
    let zoneCache: Map<number, number> | undefined
    if (cacheable) {
        zoneCache = offsetCache.get(zone)
        if (!zoneCache) {
            zoneCache = new Map()
            offsetCache.set(zone, zoneCache)
        }
        const cached: number | undefined = zoneCache.get(bucket)
        if (cached !== undefined) return cached
    }
    const offset: number = computeOffset(zone, instant)
    if (zoneCache) {
        if (zoneCache.size >= MAX_CACHED_OFFSETS) zoneCache.clear()
        zoneCache.set(bucket, offset)
    }
    return offset
}

/**
 * Computes the offset of a time zone at an instant: the difference between its wall clock (read as UTC) and the instant
 * @param zone
 * @param instant
 */
function computeOffset(zone: string, instant: number): number {
    const parts: Intl.DateTimeFormatPart[] = fieldFormatter(zone).formatToParts(instant)
    let year: number = 0
    let month: number = 0
    let day: number = 0
    let hour: number = 0
    let minute: number = 0
    let second: number = 0
    let bc: boolean = false
    for (const part of parts) {
        switch (part.type) {
            case 'year':
                year = +part.value
                break
            case 'month':
                month = +part.value
                break
            case 'day':
                day = +part.value
                break
            case 'hour':
                hour = +part.value
                break
            case 'minute':
                minute = +part.value
                break
            case 'second':
                second = +part.value
                break
            case 'era':
                bc = part.value === 'BC' || part.value === 'B'
                break
        }
    }
    if (bc) year = 1 - year
    const wall: Date = new Date(0)
    wall.setUTCFullYear(year, month - 1, day)
    wall.setUTCHours(hour, minute, second, 0)
    //The wall clock has no milliseconds: the instant is compared without them
    const instantSeconds: number = instant - (((instant % 1000) + 1000) % 1000)
    return (wall.getTime() - instantSeconds) / 60000
}

/**
 * The short name of a time zone at an instant (like EST, or GMT+8)
 * @param zone
 * @param instant
 */
export function ZoneAbbreviation(zone: string, instant: number): string {
    return zoneName(zone, instant, 'short')
}

/**
 * The long name of a time zone at an instant (like China Standard Time)
 * @param zone
 * @param instant
 */
export function ZoneLongName(zone: string, instant: number): string {
    return zoneName(zone, instant, 'long')
}

/**
 * The formatters of the time zone names, by time zone and style
 */
const nameFormatters: Map<string, Intl.DateTimeFormat> = new Map()

/**
 * The name of a time zone at an instant
 * @param zone
 * @param instant
 * @param style
 */
function zoneName(zone: string, instant: number, style: 'short' | 'long'): string {
    const key: string = `${style}:${zone}`
    let formatter: Intl.DateTimeFormat | undefined = nameFormatters.get(key)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {timeZone: zone, timeZoneName: style})
        nameFormatters.set(key, formatter)
    }
    return formatter.formatToParts(instant).find((part: Intl.DateTimeFormatPart): boolean => part.type === 'timeZoneName')?.value || ''
}
