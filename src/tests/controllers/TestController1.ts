import {Controller} from '../../lib/core/Controller.js'
import {Application} from '../../lib/core/Application.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Before} from '../../decorators/asst/Before.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {DTO} from '../../lib/core/DTO.js'
import {After} from '../../decorators/asst/After.js'

export class TestController1 extends Controller {

    @Inject()
    protected readonly app: Application//TODO 不一定要在controller里面预先声明app字段

    protected async init(): Promise<void> {
        console.log('TestController11111')
    }

    @After((res) => {
        console.log('after', res)
    })
    @Before(function (a: string, b: number) {
        // console.log('this:',this)
        console.log('before', a, b)
        return ['hahaha', 6666]
    })
    public async test(a: string, b: number) {
        console.log('test func invoked', a, b)
        return `ok ${a} ${b}`
    }
}
