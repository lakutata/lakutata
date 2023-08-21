import {Module} from '../../../lib/base/Module'
import {Application} from '../../../lib/Application'
import {Configurable, Inject, Lifetime} from '../../../decorators/DependencyInjectionDecorators'
import {LoadEntryCommonOptions} from '../../../options/LoadEntryCommonOptions'
import {LoadEntryClassOptions} from '../../../options/LoadEntryClassOptions'
import {TestComponent} from '../../components/TestComponent'
import {IConstructor} from '../../../interfaces/IConstructor'
import {AsyncFunction} from '../../../types/AsyncFunction'
import {ModuleOptions} from '../../../options/ModuleOptions'
import {functionConfig, objectConfig} from './config/testConfig'

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
