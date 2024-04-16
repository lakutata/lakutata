import {Controller} from '../../components/entrypoint/lib/Controller.js'
import {Inject} from '../../decorators/di/Inject.js'
import {CLIAction} from '../../decorators/ctrl/CLIAction.js'
import {HTTPAction} from '../../decorators/ctrl/HTTPAction.js'
import {DTO} from '../../lib/core/DTO.js'
import type {ActionPattern} from '../../types/ActionPattern.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {ContextType} from '../../lib/base/Context.js'
import {ServiceAction} from '../../decorators/ctrl/ServiceAction.js'
import {HTTPContext} from '../../lib/context/HTTPContext.js'
import {As} from '../../lib/helpers/As.js'
import {isProxy} from 'node:util/types'
import {Time} from '../../lib/core/Time.js'
import {Logger} from '../../components/Logger.js'
import {Application} from '../../lib/core/Application.js'

class TestDTO extends DTO {
    @Expect(DTO.String().optional())
    public aaa: string

    @Expect(DTO.Number().required().strict(false).description('hahahaha'))
    public bbb: number
}

export class TestController1 extends Controller {

    @Inject()
    protected readonly log: Logger

    @Inject(Application)
    protected readonly app: Application

    protected async destroy(): Promise<void> {
        console.log(this.className, 'destroyed')
    }

    protected async init(): Promise<void> {
        this.log.info('TestController11111')
        // this.log.info(this.app)
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
    public async test(inp) {
        setImmediate(()=>{
            this.app.reload()
        })
        return 'oh!'
    }

    @HTTPAction('/test1', ['GET', 'POST'])
    public async test2(inp) {
        return 'oh!!'
    }

    @HTTPAction('/test/:id', ['GET', 'POST'], TestDTO)
    @CLIAction('test3', TestDTO)
    @ServiceAction({
        act: 'test3',
        bbc: {
            abc: true,
            ccc: 1
        }
    })
    public async test3(inp: ActionPattern<TestDTO>) {
        if (this.context.type === ContextType.CLI) console.log('cli!')
        console.log(inp, this.context.type)

        // //Reload app
        // setTimeout(() => {
        //     this.app.reload()
        // }, 1000)

        // if (this.context.type === ContextType.HTTP) {
        //     console.log(isProxy(As<HTTPContext>(this.context).response))
        //     As<HTTPContext>(this.context).response.write(new Time().format())
        //     As<HTTPContext>(this.context).response.end()
        // } else {
        //     // await Delay(3000)
        //     return 'oh!!!!!!!!!!'
        // }
        return 'oh!!!!!!!!!!' + this.getEnv('TEST', 'abcd')
    }

}
