import {Controller} from '../../lib/core/Controller.js'
import {Application} from '../../lib/core/Application.js'
import {Inject} from '../../decorators/di/Inject.js'
import {CLIAction} from '../../decorators/ctrl/CLIAction.js'
import {HTTPAction} from '../../decorators/ctrl/HTTPAction.js'
import {DTO} from '../../lib/core/DTO.js'
import type {ActionPattern} from '../../types/ActionPattern.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {ContextType} from '../../lib/base/Context.js'
import {ServiceAction} from '../../decorators/ctrl/ServiceAction.js'

class TestDTO extends DTO {
    @Expect(DTO.String().optional())
    public aaa: string

    @Expect(DTO.Number().required().description('hahahaha'))
    public bbb: number
}

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

    @HTTPAction('/test1', ['GET', 'POST'])
    public async test2(inp) {
        return 'oh!!'
    }

    @HTTPAction('/test/:id', ['GET', 'POST'])
    @CLIAction('test3', TestDTO)
    @ServiceAction({act: 'test3'})
    public async test3(inp: ActionPattern<TestDTO>) {
        if (this.context.type === ContextType.CLI) console.log('cli!')
        return 'oh!!!!!!!!!!'
    }

}
