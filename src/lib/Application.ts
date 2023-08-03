import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Container} from './base/Container.js'
import {AsyncConstructor} from 'async-constructor'

export class Application extends AsyncConstructor {

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
        await this.container.load(this.options.entries)
        const ob=await this.container.get<any>('ob')
        console.log(await ob.testRun())
        await this.container.destroy()
    }
}
