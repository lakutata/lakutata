import {Controller} from '../../lib/core/Controller.js'
import {Application} from '../../lib/core/Application.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Before} from '../../decorators/asst/Before.js'
import {After} from '../../decorators/asst/After.js'
import {CLIAction} from '../../decorators/ctrl/CLIAction.js'
import {HTTPAction} from '../../decorators/ctrl/HTTPAction.js'
import {ServiceAction} from '../../decorators/ctrl/ServiceAction.js'

export class TestController1 extends Controller {

    @Inject()
    protected readonly app: Application//TODO 不一定要在controller里面预先声明app字段

    protected async init(): Promise<void> {
        console.log('TestController11111')
    }

    // @After((res) => {
    //     console.log('after', res)
    // })
    // @Before(function (a: string, b: number) {
    //     // console.log('this:',this)
    //     console.log('before', a, b)
    //     return ['hahaha', 6666]
    // })
    // @CLIAction()
    @HTTPAction('/test', 'GET')
    // @ServiceAction({})
    public async test(inp, stream) {
        return 'oh!'
    }

}
