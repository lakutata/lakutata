import {As} from '@lakutata/utils/helper/As'
import {ThrowWarning} from './ThrowWarning.js'

type BasicInfo = {
    appId: string
    appName: string
    timezone: string
    mode: 'development' | 'production'
}

/**
 * Whether a time zone is known by the runtime: the canonical IANA names and their aliases ("UTC", "Etc/GMT+8", "US/Eastern")
 * @param timezone
 */
function IsTimezone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', {timeZone: timezone})
        return true
    } catch {
        return false
    }
}

/**
 * Whether passed timezone parameter is a valid timezone string or not
 * If passed timezone is valid, return the timezone string, else return default timezone string
 * @param timezone
 * @constructor
 */
export function ValidateTimezone(timezone: string): string {
    const defaultTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!IsTimezone(timezone)) {
        ThrowWarning(`The passed time zone "${timezone}" is invalid, use the default time zone "${defaultTimezone}"`)
        return defaultTimezone
    }
    return timezone
}

/**
 * Set application basic info
 * @param info
 * @constructor
 */
export function SetBasicInfo(info: BasicInfo): BasicInfo {
    process.env.appId = info.appId
    process.env.appName = info.appName
    const timezone: string = info.timezone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : info.timezone
    process.env.TZ = ValidateTimezone(timezone)
    process.env.NODE_ENV = info.mode ? info.mode : 'development'
    return GetBasicInfo()
}

/**
 * Get application id (reads a single environment variable, much cheaper than GetBasicInfo())
 * @constructor
 */
export function GetAppId(): string {
    return process.env.appId || 'Unknown'
}

/**
 * Get application name (reads a single environment variable, much cheaper than GetBasicInfo())
 * @constructor
 */
export function GetAppName(): string {
    return process.env.appName || 'Unknown'
}

/**
 * Get application basic info
 * @constructor
 */
export function GetBasicInfo(): BasicInfo {
    return {
        appId: GetAppId(),
        appName: GetAppName(),
        timezone: As<string>(process.env.TZ),
        mode: process.env.NODE_ENV ? As<'development'>(process.env.NODE_ENV) : 'development'
    }
}
