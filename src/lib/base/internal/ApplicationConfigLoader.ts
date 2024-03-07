import {ModuleConfigLoader} from './ModuleConfigLoader.js'
import {LoadObjectOptions} from '../../../options/LoadObjectOptions.js'
import {BaseObject} from '../BaseObject.js'
import {ApplicationOptions} from '../../../options/ApplicationOptions.js'

export class ApplicationConfigLoader extends ModuleConfigLoader {
    constructor(applicationOptions: ApplicationOptions, presetLoadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []) {
        super(applicationOptions, presetLoadOptions)
        //TODO
    }
}
