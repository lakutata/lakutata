import {Module} from '../../../lib/base/Module.js'
import {Application} from '../../../lib/Application.js'
import {Configurable, Inject, Lifetime} from '../../../decorators/DependencyInjectionDecorators.js'
import {LoadEntryCommonOptions} from '../../../options/LoadEntryCommonOptions.js'
import {LoadEntryClassOptions} from '../../../options/LoadEntryClassOptions.js'
import {TestComponent} from '../../components/TestComponent.js'
import {IConstructor} from '../../../interfaces/IConstructor.js'
import {AsyncFunction} from '../../../types/AsyncFunction.js'
import {ModuleOptions} from '../../../options/ModuleOptions.js'
import {functionConfig, objectConfig} from './config/testConfig.js'

@Lifetime('SINGLETON')
export class TestModule1 extends Module {

    @Inject(Application)
    protected readonly app: Application

    @Configurable()
    protected readonly greet: string

    protected async entries(): Promise<Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<any>>> {
        return {
            tt11: {class: TestComponent, greet: 'subModule'}
        }
    }

    protected async configure(): Promise<ModuleOptions<this> | undefined> {
        return await functionConfig()
        // return objectConfig
    }

    // protected async entries(): Promise<Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<any>>> {
    //     return {
    //         tt11: {class: TestComponent, config: {greet: 'subModule'}},
    //         stc: {class: (await import('../../components/SubTestComponent.js')).SubTestComponent}
    //     }
    // }
    //
    // protected bootstrap<U extends Module>(): (string | IConstructor<any> | AsyncFunction<U, void>)[] {
    //     return [
    //         async () => {
    //             console.log('TestModule1 bootstrap')
    //         },
    //         'tt11',
    //         'stc'
    //     ]
    // }

    protected async init(): Promise<void> {
        await super.init()
        console.log('this is test from ', this.greet ? this.greet : this.className)
    }
}
