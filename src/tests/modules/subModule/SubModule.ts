import {AsyncFunction, IConstructor, LoadComponentOptions, Module} from '../../../Lakutata'
import {TestComponent} from '../../components/TestComponent'

export class SubModule extends Module {

    /**
     * 模块内联组件声明
     * @protected
     */
    protected async components(): Promise<Record<string, IConstructor<any> | LoadComponentOptions<any>>> {
        return {
            test: {
                class: TestComponent
            }
        }
    }

    /**
     * 模块内联启动引导
     * @protected
     */
    protected async bootstrap<U extends Module>(): Promise<(string | IConstructor<any> | AsyncFunction<U, void>)[]> {
        return ['test']
    }
}
