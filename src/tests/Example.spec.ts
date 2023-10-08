import {AccessControl, Application, Container, Logger} from '../Lakutata'
import {BaseEntity} from '../ORM'
import {MathObject} from './objects/MathObject'
import {UserModel} from './models/UserModel'
import {FibonacciThreadTask} from './threads/FibonacciThreadTask'
import os from 'node:os'
import {SayHelloInterval} from './objects/SayHelloInterval'
import {GreetCron} from './objects/GreetCron'
import {TestComponent} from './components/TestComponent'
import {SubModule} from './modules/subModule/SubModule'
import {SubProcess} from './processes/SubProcess'


(async (): Promise<void> => {
    console.log('BaseEntity:',BaseEntity)
    await Application.run({
        id: 'example.lakutata.app',
        name: 'LakutataExampleApplication',
        timezone: 'Asia/Shanghai',
        mode: 'production',
        alias: {
            '@data': '@app/data',
            '@controllers': '@app/controllers',
            '@models': '@app/models'
        },
        entries: {
            sayHello: {
                class: SayHelloInterval,
                interval: 1000,
                mode: 'SEQ'
            },
            greet: {
                class: GreetCron,
                expression: '1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35,37,39,41,43,45,47,49,51,53,55,57,59 * * * * ? '
            },
            math: {
                class: MathObject,
                baseNumber: 32
            },
            fibonacci: {
                class: FibonacciThreadTask,
                maxThreads: os.cpus().length
            },
            proc: {
                class: SubProcess,
                text: 'Default text'
            }
        },
        components: {
            access: {
                class: AccessControl,
                store: {type: 'file', filename: '@data/auth.csv'}
            },
            test: {
                class: TestComponent
            }
        },
        modules: {
            sub: {
                class: SubModule
            }
        },
        autoload: ['@models/**/*'],
        controllers: ['@controllers/**/*'],
        bootstrap: [
            'test',
            'sub',
            async (app: Application): Promise<void> => {
                const logger: Logger = await app.get<Logger>('log')
                const scope1: Container = app.createScope()
                const scope2: Container = app.createScope()
                await scope2.get('sayHello')
                await scope2.get('greet')
                const proc: SubProcess = await scope2.get<SubProcess>('proc')
                proc.echoText()
                proc.text = 'Oh! The text is changed'
                proc.echoText()
                const user: UserModel = await scope1.get(UserModel, {id: '89757', username: 'robot1'})
                const accessControl: AccessControl = await app.get<AccessControl>('access', {user: user})
                await accessControl.createUserPermission('add', 'execute')
                logger.info('Math function "add" invoke result: %s', await app.dispatchToController({
                    ctrl: 'math',
                    act: 'add',
                    a: 123
                }, {user: user}))
                await scope2.destroy()
            }
        ]
    })
})()
