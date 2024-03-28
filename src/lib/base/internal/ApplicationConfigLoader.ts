import {ModuleConfigLoader} from './ModuleConfigLoader.js'
import {LoadObjectOptions} from '../../../options/LoadObjectOptions.js'
import {BaseObject} from '../BaseObject.js'
import {ApplicationOptions} from '../../../options/ApplicationOptions.js'
import {SetBasicInfo} from './BasicInfo.js'
import {Application} from '../../core/Application.js'

export class ApplicationConfigLoader extends ModuleConfigLoader {

    constructor(app: Application, applicationOptions: ApplicationOptions, presetLoadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []) {
        if (ApplicationOptions.isValid(applicationOptions)) {
            process.title = SetBasicInfo({
                appId: applicationOptions.id,
                appName: applicationOptions.name,
                timezone: applicationOptions.timezone ? applicationOptions.timezone : 'auto',
                mode: applicationOptions.mode ? applicationOptions.mode : 'development'
            }).appId
        }
        super(app, applicationOptions, presetLoadOptions)
    }
}
