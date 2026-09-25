import {ModuleConfigLoader} from '../base/internal/ModuleConfigLoader.js'
import {LoadObjectOptions} from '../../options/LoadObjectOptions.js'
import {BaseObject} from '../base/BaseObject.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {SetBasicInfo} from '../foundation/BasicInfo.js'
import {Application} from './Application.js'

/**
 * Application configurations loader
 */
export class ApplicationConfigLoader extends ModuleConfigLoader {

    /**
     * Constructor
     * @param app
     * @param applicationOptions
     * @param presetLoadOptions
     */
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
