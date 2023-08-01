import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {AsyncConstructor} from 'async-constructor'

export class Application extends AsyncConstructor {

    protected readonly options: ApplicationOptions

    constructor(options: ApplicationOptions) {
        super(async (): Promise<void> => await this.bootstrap())
        this.options = ApplicationOptions.validate(options)
        process.env.appId = this.options.id
        process.env.appName = this.options.name
        process.env.TZ = this.options.timezone
    }

    /**
     * 应用程序启动引导
     * @protected
     */
    protected async bootstrap(): Promise<void> {
        //todo
        console.log('bootstrap')
    }

    public config() {
    }

    public ready() {
    }
}
