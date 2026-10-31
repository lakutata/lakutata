import {ModuleConfigLoader} from '../base/internal/ModuleConfigLoader.js'
import {LoadObjectOptions} from '../../options/LoadObjectOptions.js'
import {BaseObject} from '../base/BaseObject.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {resolveMode, setBasicInfo} from '../foundation/BasicInfo.js'
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
            const appId: string = setBasicInfo({
                appId: applicationOptions.id,
                appName: applicationOptions.name,
                timezone: applicationOptions.timezone ? applicationOptions.timezone : 'auto',
                //MODE, NODE_ENV, the options, development
                mode: resolveMode(applicationOptions.mode)
            }).appId
            //The process is named after the application, except in NW.js: its Node.js runs in a renderer process of
            //Chromium, whose title would make it an application of its own (an icon in the Dock of macOS)
            if (!process.versions.nw) process.title = appId
        }
        super(app, applicationOptions, presetLoadOptions)
    }
}
