import {Controller} from '@lakutata/core'
import {Inject} from '@lakutata/core'
import {CLIAction} from '@lakutata/core'
import {HTTPAction} from '@lakutata/core'
import {DTO} from '@lakutata/core'
import type {ActionPattern} from '@lakutata/core'
import {Expect} from '@lakutata/core'
import {ContextType} from '@lakutata/core'
import {ServiceAction} from '@lakutata/core'
import {HTTPContext} from '@lakutata/core'
import {As} from '@lakutata/core'
import {isProxy} from 'node:util/types'
import {Time} from '@lakutata/core'
import {Logger} from '@lakutata/core'
import {Application} from '@lakutata/core'
import {GET} from '@lakutata/core'
import {After} from '@lakutata/core'

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
    // @HTTPAction('/test', 'GET')
    @GET('/test')
    // @ServiceAction({})
    @After(async function (result) {
        console.log(this.context, 'result:', result)
    })
    public async test(inp) {
        // setImmediate(()=>{
        //     this.app.reload()
        // })
        return 1234
    }

    @HTTPAction('/test1', ['GET', 'POST'])
    public async test2(inp) {
        return 'oh!!'
    }

    @HTTPAction('/test/:id', ['GET', 'POST'], TestDTO, {
        acl: true,
        // acl: false,
        name: 'ddd',
        groups: ['a', 'b', 'c'],
        description: '哈哈哈哈',
        // allow: async function (this: TestController1, inp: ActionPattern<TestDTO>) {
        //     return true
        // }
        rule: async function (this: TestController1, context, input: ActionPattern) {
            // console.log(context)
            console.log('this from rule handler')
            return true
            // return false
        }
    })
    // @HTTPAction('/test/:id', ['GET', 'POST'], TestDTO)
    // @HTTPAction('/test/:id', ['GET', 'POST'])
    @CLIAction('test3', TestDTO)
    @ServiceAction({
        act: 'test3',
        bbc: {
            abc: true,
            ccc: 1
        }
    })
    public async test3(inp: ActionPattern<TestDTO>) {
        TestController1.className
        if (this.context.type === ContextType.CLI) console.log('cli!')
        // console.log('this.context:', this.context)
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
