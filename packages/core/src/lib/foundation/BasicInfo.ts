import {As} from '@lakutata/utils/As'
import {throwWarning} from './ThrowWarning.js'

type BasicInfo = {
    appId: string
    appName: string
    timezone: string
    mode: 'development' | 'production'
}

/**
 * An environment variable, read by its computed name: the bundlers replace the reads of process.env.NODE_ENV with the
 * mode of their build (Bun: "development"), the mode of the run would be lost
 * @param name
 */
function variable(name: string): string | undefined {
    return process.env[name]
}

/**
 * A mode of the environment (development or production, in any case), undefined for the other values
 * @param value
 */
function modeOf(value: string | undefined): 'development' | 'production' | undefined {
    const mode: string | undefined = value?.trim().toLowerCase()
    return mode === 'development' || mode === 'production' ? mode : undefined
}

/**
 * The mode of the application: the environment overrides the options (the same build runs in each mode). The one of
 * the MODE environment variable (the one of lakutata), of NODE_ENV, of the options, development otherwise. A MODE
 * which is not a mode is warned of and left; a NODE_ENV which is not a mode (test) is left
 * @param configured the mode of the options of the application
 */
export function resolveMode(configured?: 'development' | 'production'): 'development' | 'production' {
    const mode: 'development' | 'production' | undefined = modeOf(variable('MODE'))
    if (mode) return mode
    if (variable('MODE')?.trim()) throwWarning(`The MODE environment variable "${variable('MODE')}" is not a mode (development, production), it is ignored`)
    return modeOf(variable('NODE_ENV')) ?? configured ?? 'development'
}

/**
 * The mode of the application running: the one written to MODE and NODE_ENV when it launched, development otherwise
 */
export function currentMode(): 'development' | 'production' {
    return modeOf(variable('MODE')) ?? modeOf(variable('NODE_ENV')) ?? 'development'
}

/**
 * Whether a time zone is known by the runtime: the canonical IANA names and their aliases ("UTC", "Etc/GMT+8", "US/Eastern")
 * @param timezone
 */
function isTimezone(timezone: string): boolean {
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
export function validateTimezone(timezone: string): string {
    const defaultTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!isTimezone(timezone)) {
        throwWarning(`The passed time zone "${timezone}" is invalid, use the default time zone "${defaultTimezone}"`)
        return defaultTimezone
    }
    return timezone
}

/**
 * Set application basic info
 * @param info
 * @constructor
 */
export function setBasicInfo(info: BasicInfo): BasicInfo {
    process.env.appId = info.appId
    process.env.appName = info.appName
    const timezone: string = info.timezone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : info.timezone
    process.env.TZ = validateTimezone(timezone)
    //The mode in both variables: the libraries read NODE_ENV, the applications MODE too
    process.env.NODE_ENV = info.mode
    process.env.MODE = info.mode
    return getBasicInfo()
}

/**
 * Get application id (reads a single environment variable, much cheaper than getBasicInfo())
 * @constructor
 */
export function getAppId(): string {
    return process.env.appId || 'Unknown'
}

/**
 * Get application name (reads a single environment variable, much cheaper than getBasicInfo())
 * @constructor
 */
export function getAppName(): string {
    return process.env.appName || 'Unknown'
}

/**
 * Get application basic info
 * @constructor
 */
export function getBasicInfo(): BasicInfo {
    return {
        appId: getAppId(),
        appName: getAppName(),
        timezone: As<string>(process.env.TZ),
        mode: currentMode()
    }
}
