import {As} from '../../functions/As.js'

type BasicInfo = {
    appId: string
    appName: string
    timezone: string
    mode: 'development' | 'production'
}

/**
 * Set application basic info
 * @param info
 * @constructor
 */
export function SetBasicInfo(info: BasicInfo): BasicInfo {
    process.env.appId = info.appId
    process.env.appName = info.appName
    process.env.TZ = info.timezone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : info.timezone
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
