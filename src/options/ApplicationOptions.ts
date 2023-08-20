import {Expect} from '../decorators/ValidationDecorators.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Application} from '../lib/Application.js'
import {ModuleOptions} from './ModuleOptions.js'
import {Validator} from '../exports/Validator.js'

export class ApplicationOptions<T extends BaseObject = BaseObject> extends ModuleOptions<Application, T> {

    /**
     * 应用程序ID
     */
    @Expect(Validator.String().required())
    public declare readonly id: string

    /**
     * 应用程序名称
     */
    @Expect(Validator.String().required())
    public declare readonly name: string

    /**
     * 应用程序时区
     */
    @Expect(Validator.String().optional())
    public declare readonly timezone?: string

    /**
     * 运行环境（开发环境/正式环境）
     */
    @Expect(Validator.String().valid('development', 'production').optional().default('development'))
    public declare readonly mode?: 'development' | 'production'

    /**
     * 路径别名
     */
    @Expect(Validator.Object().pattern(Validator.String(), Validator.String()).optional().default({}))
    public declare readonly alias?: Record<string, string>
}
