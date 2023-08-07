import {SubTestComponent} from '../../components/SubTestComponent.js'
import {Module} from '../../../lib/base/Module.js'
import {Application} from '../../../lib/Application.js'
import {Configurable, Inject} from '../../../decorators/DependencyInjectionDecorators.js'
import {LoadEntryCommonOptions} from '../../../options/LoadEntryCommonOptions.js'
import {LoadEntryClassOptions} from '../../../options/LoadEntryClassOptions.js'
import {TestComponent} from '../../components/TestComponent.js'
import {IConstructor} from '../../../interfaces/IConstructor.js'
import {AsyncFunction} from '../../../types/AsyncFunction.js'

export class TestModule1 extends Module {

    @Inject(Application)
    protected readonly app: Application

    @Configurable()
    protected readonly greet: string

    protected entries(): Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<any>> {
        // console.log(import('../../components/SubTestComponent.js'))
        return {
            tt11: {class: TestComponent, config: {greet: 'subModule'}},
            stc: {class: SubTestComponent}
        }
    }

    protected bootstrap<U extends Module>(): (string | IConstructor<any> | AsyncFunction<U, void>)[] {
        return [
            async () => {
                console.log('TestModule1 bootstrap')
            },
            'tt11',
            'stc'
        ]
    }

    protected async init(): Promise<void> {
        await super.init()
        console.log('this is test from ', this.greet ? this.greet : this.className)
    }
}
