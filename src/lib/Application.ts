import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Container} from './base/Container.js'
import {Module} from './base/Module.js'

export class Application extends Module {

    protected readonly declare options: ApplicationOptions

    public static async run(options: ApplicationOptions): Promise<Application> {
        options = await ApplicationOptions.validateAsync(options)
        process.env.appId = options.id
        process.env.appName = options.name
        process.env.TZ = options.timezone
        const rootContainer: Container = new Container()
        const name: string = Container.stringifyConstructor(Application)
        await rootContainer.load({
            [name]: {
                class: Application,
                lifetime: 'SINGLETON',
                config: {
                    __$$options: options,
                    __$$parentContainer: rootContainer
                }
            }
        })
        return await rootContainer.get<Application>(name)
    }

    /**
     * 退出应用程序
     */
    public async exit(): Promise<void> {
        await this.__$$container.destroy()
        process.exit(0)
    }
}


