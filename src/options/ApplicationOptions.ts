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
    public readonly id: string

    /**
     * 应用程序名称
     */
    @Accept(Validator.String().required())
    public readonly name: string

    /**
     * 应用程序时区
     */
    @Accept(Validator.String().optional())
    public readonly timezone?: string

    /**
     * 运行环境（开发环境/正式环境）
     */
    @Accept(Validator.String().valid('development', 'production').optional().default('development'))
    public readonly mode?: 'development' | 'production'
}
