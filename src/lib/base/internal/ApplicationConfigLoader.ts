import {ModuleConfigLoader} from './ModuleConfigLoader.js'
import {LoadObjectOptions} from '../../../options/LoadObjectOptions.js'
import {BaseObject} from '../BaseObject.js'
import {ApplicationOptions} from '../../../options/ApplicationOptions.js'
import {Alias} from '../../Alias.js'

export class ApplicationConfigLoader extends ModuleConfigLoader {

    constructor(applicationOptions: ApplicationOptions, presetLoadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []) {
        const alias: Alias = Alias.getAliasInstance()
        if (applicationOptions.alias) {
            const aliases: Record<string, string> = applicationOptions.alias ? applicationOptions.alias : {}
            Object.keys(aliases).forEach((aliasName: string) => alias.set(aliasName, aliases[aliasName]))
        }
        if (ApplicationOptions.isValid(applicationOptions)) {
            process.env.appId = applicationOptions.id
            process.env.appName = applicationOptions.name
            process.env.TZ = applicationOptions.timezone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : applicationOptions.timezone
            process.env.NODE_ENV = applicationOptions.mode ? applicationOptions.mode : 'development'
            process.title = process.env.appId
        }
        super(applicationOptions, presetLoadOptions)
    }
}
