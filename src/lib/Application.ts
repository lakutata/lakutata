import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Container} from './base/Container.js'
import {isAsyncFunction} from 'util/types'
import {As} from '../Utilities.js'
import {AsyncFunction} from '../types/AsyncFunction.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {BaseObject} from './base/BaseObject.js'
import {Module} from './base/Module.js'
import {InjectionProperties} from '../types/InjectionProperties.js'
import {Configurable} from '../decorators/DependencyInjectionDecorators.js'
import {inherits} from 'util'

export class Application extends Module {

    protected readonly declare options: ApplicationOptions

    public static async run(options: ApplicationOptions): Promise<void> {
        const rootContainer = new Container()
        options = await ApplicationOptions.validateAsync(options)
        process.env.appId = options.id
        process.env.appName = options.name
        process.env.TZ = options.timezone
        // await Application.instantiate({
        //     _$options: options,
        //     _$parentContainer: rootContainer
        // })
        await rootContainer.load({
            'app': {
                class: Application,
                lifetime: 'SINGLETON',
                config:{
                    _$options: options,
                    _$parentContainer: rootContainer
                }
            }
        })
        const application: Application = await rootContainer.get<Application>('app')

        // await rootContainer.registerModule(Application, {
        //     lifetime: 'SINGLETON', config: {
        //         _$options: options,
        //         _$parentContainer: rootContainer
        //         // _$parentContainer: new Container()
        //     }
        // })
        // const application: Application = await rootContainer.get<Application>(Application)
        // Object.defineProperty(application, 'container', {
        //     get: () => {
        //         return rootContainer
        //     }
        // })
        // return application
    }

    /**
     * 退出应用程序
     */
    public async exit(): Promise<void> {
        await this._$container.destroy()
        process.exit(0)
    }
}


