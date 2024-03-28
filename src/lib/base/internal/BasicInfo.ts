import {As} from '../../functions/As.js'
import MomentTimezone from 'moment-timezone'
import {ThrowWarning} from './ThrowWarning.js'

type BasicInfo = {
    appId: string
    appName: string
    timezone: string
    mode: 'development' | 'production'
}

/**
 * Whether passed timezone parameter is a valid timezone string or not
 * If passed timezone is valid, return the timezone string, else return default timezone string
 * @param timezone
 * @constructor
 */
function ValidateTimezone(timezone: string): string {
    const timezones: string[] = [...MomentTimezone.tz.names()]
    const defaultTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!timezones.map((timezone: string) => timezone.toLowerCase()).includes(timezone.toLowerCase())) {
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
 * Get application basic info
 * @constructor
 */
export function GetBasicInfo(): BasicInfo {
    return {
        appId: process.env.appId ? process.env.appId : 'Unknown',
        appName: process.env.appName ? process.env.appName : 'Unknown',
        timezone: As<string>(process.env.TZ),
        mode: process.env.NODE_ENV ? As<'development'>(process.env.NODE_ENV) : 'development'
    }
}
