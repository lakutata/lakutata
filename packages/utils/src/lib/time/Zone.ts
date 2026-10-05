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
 * The time zone of the system (read once)
 */
let systemZone: string | undefined

/**
 * The last TZ environment variable, and the time zone it gives
 */
let lastTZ: string | undefined
let lastTZZone: string = 'UTC'

/**
 * The default time zone: the TZ environment variable, else the time zone of the system; like Date, an invalid TZ
 * environment variable gives UTC
 */
export function defaultZone(): string {
    const tz: string | undefined = process.env.TZ
    if (tz) {
        if (tz !== lastTZ) {
            lastTZ = tz
            lastTZZone = isZone(tz) ? tz : 'UTC'
        }
        return lastTZZone
    }
    if (systemZone === undefined) systemZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    return systemZone
}

/**
 * Whether a time zone is supported
 * @param zone
 */
function isZone(zone: string): boolean {
    try {
        fieldFormatter(zone)
        return true
    } catch {
        return false
    }
}

/**
 * The time zones Intl names by their former names (the ones of CLDR), renamed since by the IANA database: the names of
 * the cities which changed, and the zones moved under a country. The zones merged by IANA with another one (Europe/Amsterdam
 * with Europe/Brussels) are not renamed, they are other places
 */
const RENAMED_ZONES: Record<string, string> = {
    'Africa/Asmera': 'Africa/Asmara',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'America/Catamarca': 'America/Argentina/Catamarca',
    'America/Cordoba': 'America/Argentina/Cordoba',
    'America/Jujuy': 'America/Argentina/Jujuy',
    'America/Mendoza': 'America/Argentina/Mendoza',
    'America/Indianapolis': 'America/Indiana/Indianapolis',
    'America/Louisville': 'America/Kentucky/Louisville',
    'America/Coral_Harbour': 'America/Atikokan',
    'America/Godthab': 'America/Nuuk',
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Asia/Rangoon': 'Asia/Yangon',
    'Atlantic/Faeroe': 'Atlantic/Faroe',
    'Europe/Kiev': 'Europe/Kyiv',
    'Pacific/Enderbury': 'Pacific/Kanton',
    'Pacific/Ponape': 'Pacific/Pohnpei',
    'Pacific/Truk': 'Pacific/Chuuk'
}

/**
 * The names of the time zones (read once)
 */
let zoneNames: string[] | undefined

/**
 * The names of the time zones the runtime supports, by their current IANA names: the time zones of the places Intl lists
 * (renamed as the IANA database names them now), UTC and the fixed offsets Etc/GMT-14…Etc/GMT+12, which Intl does not list
 */
export function supportedZoneNames(): string[] {
    if (!zoneNames) {
        const names: Set<string> = new Set()
        for (const zone of Intl.supportedValuesOf('timeZone')) {
            const renamed: string | undefined = RENAMED_ZONES[zone]
            names.add(renamed && isZone(renamed) ? renamed : zone)
        }
        const fixed: string[] = ['UTC']
        //The offset 0 is UTC
        for (let offset: number = -14; offset <= 12; offset++) if (offset) fixed.push(`Etc/GMT${offset < 0 ? offset : `+${offset}`}`)
        for (const zone of fixed) if (isZone(zone)) names.add(zone)
        zoneNames = [...names].sort()
    }
    return [...zoneNames]
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
export function assertZone(zone: string): void {
    if (!isZone(zone)) throw new RangeError(`Invalid time zone: ${zone}`)
}

/**
 * The offset from UTC of a time zone at an instant, in minutes (positive east of Greenwich)
 * @param zone
 * @param instant milliseconds since the epoch
 */
export function offsetAt(zone: string, instant: number): number {
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
export function zoneAbbreviation(zone: string, instant: number): string {
    return zoneName(zone, instant, 'short')
}

/**
 * The long name of a time zone at an instant (like China Standard Time)
 * @param zone
 * @param instant
 */
export function zoneLongName(zone: string, instant: number): string {
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
