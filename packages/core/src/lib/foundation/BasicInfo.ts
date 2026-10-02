import {As} from '@lakutata/utils/As'
import {ThrowWarning} from './ThrowWarning.js'

type BasicInfo = {
    appId: string
    appName: string
    timezone: string
    mode: 'development' | 'production'
}

/**
 * A mode of the environment (development or production, in any case), undefined for the other values
 * @param value
 */
function ModeOf(value: string | undefined): 'development' | 'production' | undefined {
    const mode: string | undefined = value?.trim().toLowerCase()
    return mode === 'development' || mode === 'production' ? mode : undefined
}

/**
 * The mode of the application: the environment overrides the options (the same build runs in each mode). The one of
 * the MODE environment variable (the one of lakutata), of NODE_ENV, of the options, development otherwise. A MODE
 * which is not a mode is warned of and left; a NODE_ENV which is not a mode (test) is left
 * @param configured the mode of the options of the application
 */
export function ResolveMode(configured?: 'development' | 'production'): 'development' | 'production' {
    const mode: 'development' | 'production' | undefined = ModeOf(process.env.MODE)
    if (mode) return mode
    if (process.env.MODE?.trim()) ThrowWarning(`The MODE environment variable "${process.env.MODE}" is not a mode (development, production), it is ignored`)
    return ModeOf(process.env.NODE_ENV) ?? configured ?? 'development'
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
    //The mode in both variables: the libraries read NODE_ENV, the applications MODE too
    process.env.NODE_ENV = info.mode
    process.env.MODE = info.mode
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
