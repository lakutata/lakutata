import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {BaseObject} from './base/BaseObject.js'
import {Container} from './base/Container.js'

export class Application extends BaseObject {

    protected readonly options: ApplicationOptions

    protected readonly container: Container

    constructor(options: ApplicationOptions) {
        super(async (): Promise<void> => await this.bootstrap())
        this.options = ApplicationOptions.validate(options)
        process.env.appId = this.options.id
        process.env.appName = this.options.name
        process.env.TZ = this.options.timezone
        this.container = new Container()
    }

    /**
     * 应用程序启动引导
     * @protected
     */
    protected async bootstrap(): Promise<void> {
        //todo
        console.log('bootstrap')
    }
}
