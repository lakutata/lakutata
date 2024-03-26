import {Application} from '../lib/core/Application.js'
import {TestComponent} from './components/TestComponent.js'
import {TestModule} from './modules/TestModule.js'
import {TestProvider} from './providers/TestProvider.js'
import {TestController1} from './controllers/TestController1.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import Fastify from 'fastify'
import {As} from '../lib/functions/As.js'
import {Command} from 'commander'
import {CLIContext} from '../lib/context/CLIContext.js'
import {createInterface} from 'node:readline'
import {DevNull} from '../lib/functions/DevNull.js'
import {Server as SocketIOServer} from 'socket.io'
import {ServiceContext} from '../lib/context/ServiceContext.js'
import {createServer} from 'node:http'
import {
    BuildCLIEntrypoint,
    BuildEntrypoints,
    BuildHTTPEntrypoint,
    BuildServiceEntrypoint
} from '../components/Entrypoint.js'
import {createWriteStream} from 'node:fs'

(async (): Promise<void> => {
    await Application.run({
        id: 'test.app',
        name: 'TestApp',
        timezone: 'auto',
        components: {
            testComponent: {
                class: TestComponent
            },
            entrypoint: BuildEntrypoints({
                http: BuildHTTPEntrypoint((module, routeMap, handler) => {
                    const fastify = Fastify({
                        logger: false
                    })
                    routeMap.forEach((methods: Set<any>, route: string) => {
                        methods.forEach(method => {
                            fastify.route({
                                url: route,
                                method: method,
                                handler: async (request, reply) => {
                                    const ac = new AbortController()
                                    reply.raw.on('close', () => {
                                        console.log('close')
                                        ac.abort()
                                    })
                                    return await handler(new HTTPContext({
                                        route: request.routeOptions.url!,
                                        method: request.method,
                                        request: request.raw,
                                        response: reply.raw,
                                        data: {...As<Record<string, string>>(request.query ? request.query : {}), ...As<Record<string, string>>(request.body ? request.body : {})}
                                    }), ac)
                                }
                            })
                        })
                    })
                    fastify.listen({port: 3000, host: '0.0.0.0'})
                }),
                cli: BuildCLIEntrypoint((module, cliMap, handler) => {
                    createInterface({
                        input: process.stdin,
                        output: process.stdout
                    })
                        .on('SIGINT', () => process.exit(2))
                        .on('line', input => {
                            try {
                                const CLIProgram: Command = new Command().exitOverride()
                                cliMap.forEach((dtoJsonSchema, command: string) => {
                                    const cmd = new Command(command).exitOverride()
                                    for (const p in dtoJsonSchema.properties) {
                                        const attr = dtoJsonSchema.properties[p]
                                        cmd.option(`--${p} <${attr.type}>`, attr.description)
                                    }
                                    cmd.action((args) => {
                                        //Handle cli
                                        handler(new CLIContext({command: command, data: args}))
                                    })
                                    CLIProgram.addCommand(cmd)
                                })
                                CLIProgram.addCommand(new Command('exit').allowUnknownOption(true).action(() => process.exit()))
                                CLIProgram.parse(input.split(' '), {from: 'user'})//使用命令行传入的参数进行执行
                            } catch (e: any) {
                                DevNull(e)
                            }
                        })
                }),
                service: BuildServiceEntrypoint((module, handler) => {
                    const httpServer = createServer()
                    const server = new SocketIOServer()
                    server.on('connection', socket => {
                        socket.on('message', async (data, fn) => {
                            return fn(await handler(new ServiceContext({
                                data: data
                            })))
                        })
                    })
                    server.attach(httpServer)
                    httpServer.listen(3001, '0.0.0.0')
                })
            })
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
        ]
    })
})()
