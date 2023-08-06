import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Application} from '../lib/Application.js'
import {ModuleOptions} from './ModuleOptions.js'

export class ApplicationOptions<T extends BaseObject = BaseObject> extends ModuleOptions<Application, T> {

    /**
     * 应用程序ID
     */
    @Accept(Validator.String().required())
    readonly id: string

    /**
     * 应用程序名称
     */
    @Accept(Validator.String().required())
    readonly name: string

    /**
     * 应用程序时区
     */
    @Accept(Validator.String().optional())
    readonly timezone?: string

}
