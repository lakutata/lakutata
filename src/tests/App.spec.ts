import {Application} from '../lib/core/Application.js'
import {TestComponent} from './components/TestComponent.js'
import {TestModule} from './modules/TestModule.js'
import {TestProvider} from './providers/TestProvider.js'
import {TestController1} from './controllers/TestController1.js'
import {PatternManager} from '../lib/base/internal/PatternManager.js'
import {DTO} from '../lib/core/DTO.js'
import {Stream} from 'node:stream'
import path from 'node:path'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import Fastify from 'fastify'
import {As} from '../lib/functions/As.js'
import {Url} from 'url'
import {Delay} from '../lib/functions/Delay.js'
import {type Module} from '../lib/core/Module.js'
import {
    CLIEntrypointBuilder,
    type CLIEntrypointHandler, type CLIMap,
    HTTPEntrypointBuilder,
    type HTTPEntrypointHandler, type HTTPRouteMap, ServiceEntrypointBuilder
} from '../components/Entrypoint.js'
import {Command} from 'commander'
import {CLIContext} from '../lib/context/CLIContext.js'
import {createInterface} from 'node:readline'
import {DevNull} from '../lib/functions/DevNull.js'
import {Server} from 'socket.io'
import {ServiceContext} from '../lib/context/ServiceContext.js'

(async (): Promise<void> => {
    await Application.run({
        id: 'test.app',
        name: 'TestApp',
        timezone: 'auto',
        components: {
            testComponent: {
                class: TestComponent
            },
            entrypoint: {
                http: HTTPEntrypointBuilder((module: Module, routeMap: HTTPRouteMap, handler: HTTPEntrypointHandler) => {
                    const fastify = Fastify({
                        logger: false
                    })
                    routeMap.forEach((methods: Set<any>, route: string) => {
                        methods.forEach(method => {
                            fastify.route({
                                url: route,
                                method: method,
                                handler: async (request, reply) => {
                                    return handler(new HTTPContext({
                                        route: request.routeOptions.url!,
                                        method: request.method,
                                        data: {...As<Record<string, string>>(request.query ? request.query : {}), ...As<Record<string, string>>(request.body ? request.body : {})}
                                    }))
                                }
                            })
                        })
                    })
                    fastify.listen({port: 3000, host: '0.0.0.0'})
                }),
                cli: CLIEntrypointBuilder((module: Module, cliMap: CLIMap, handler: CLIEntrypointHandler) => {
                    const CLIProgram: Command = new Command()
                        .exitOverride()
                    cliMap.forEach((dtoJsonSchema, command: string) => {
                        const cmd = new Command(command).exitOverride()
                        for (const p in dtoJsonSchema.properties) {
                            const attr = dtoJsonSchema.properties[p]
                            cmd.option(`--${p} <${attr.type}>`, attr.description)
                        }
                        cmd.action((args) => {
                            handler(new CLIContext({command: command, data: args}))
                        })
                        CLIProgram.addCommand(cmd)
                    })
                    CLIProgram.addCommand(new Command('exit').allowUnknownOption(true).action(() => process.exit()))
                    createInterface({
                        input: process.stdin,
                        output: process.stdout
                    }).on('line', input => {
                        try {
                            CLIProgram.parse(input.split(' '), {from: 'user'})//使用命令行传入的参数进行执行
                        } catch (e: any) {
                            DevNull(e)
                        }
                    })
                }),
                service: ServiceEntrypointBuilder((module, handler) => {
                    // const server = new Server()
                    // server.on('connection', socket => {
                    //     const context=new ServiceContext({
                    //         input:{},
                    //         data:{}
                    //     })
                    // })
                    // server.listen(3001)
                })
            }
        },
        providers: {
            testProvider: {
                class: TestProvider
            }
        },
        modules: {
            testModule: {
                class: TestModule
            }
        },
        controllers: [
            TestController1
        ],
        bootstrap: [
            'testModule',
            'testComponent',
            // async (target): Promise<void> => {
            //     const testComponent = await target.getObject<TestComponent>('testComponent')
            //     const testModule = await target.getObject<TestModule>('testModule')
            //     testComponent.on('testComponentEvent', (timeStr: string) => console.log('Receive testComponentEvent    ', timeStr))
            //     testModule.on('testModuleEvent', (timeStr: string) => console.log('Receive testModuleEvent       ', timeStr))
            // },
            // async (target): Promise<void> => {
            //     const testController1 = await target.getObject(TestController1)
            //     await testController1.test('a', 1)
            // },
            'entrypoint'
            // async (target): Promise<void> => {
            //     while (true) {
            //         await Delay(100)
            //         const obj=await target.getObject<TestProvider>('testProvider')
            //         console.log(JSON.stringify(obj.getModule()))
            //     }
            // }
        ]
    })
})()
