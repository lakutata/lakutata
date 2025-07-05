import {Application} from '../lib/core/Application.js'
import {TestComponent} from './components/TestComponent.js'
import {TestModule} from './modules/TestModule.js'
import {TestProvider} from './providers/TestProvider.js'
import {TestController1} from './controllers/TestController1.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import Fastify from 'fastify'
import {As} from '../lib/helpers/As.js'
import {Command} from 'commander'
import {CLIContext} from '../lib/context/CLIContext.js'
import {createInterface} from 'node:readline'
import {DevNull} from '../lib/helpers/DevNull.js'
import {Server as SocketIOServer} from 'socket.io'
import {ServiceContext} from '../lib/context/ServiceContext.js'
import {createServer} from 'node:http'
import {
    BuildCLIEntrypoint,
    BuildEntrypoints,
    BuildHTTPEntrypoint,
    BuildServiceEntrypoint
} from '../components/entrypoint/Entrypoint.js'
import path from 'node:path'
import {createWriteStream} from 'node:fs'
import {Docker} from '../components/docker/Docker.js'
import {MD5} from '../lib/helpers/MD5.js'
import {SHA1} from '../lib/helpers/SHA1.js'
import {SHA256} from '../lib/helpers/SHA256.js'
import {TestProvider2} from './providers/TestProvider2.js'
import {TestProvider3} from './providers/TestProvider3.js'

Application
    .env({TEST: '123'})
    .run(() => ({
        id: 'test.app',
        name: 'TestApp',
        timezone: 'auto',
        components: {
            log: {
                destinations: [
                    process.stdout,
                    createWriteStream(path.resolve(__dirname, 'test.log'))
                ]
            },
            testComponent: {
                class: TestComponent
            },
            entrypoint: BuildEntrypoints({
                controllers: [
                    TestController1
                ],
                http: BuildHTTPEntrypoint((module, routeMap, handler, onDestroy) => {
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
                    onDestroy(async () => {
                        await fastify.close()
                    })
                }),
                cli: BuildCLIEntrypoint((module, cliMap, handler, onDestroy) => {
                    const inf = createInterface({
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
                                    cmd.action(async (args) => {
                                        //Handle cli
                                        await handler(new CLIContext({command: command, data: args}))
                                    })
                                    CLIProgram.addCommand(cmd)
                                })
                                CLIProgram.addCommand(new Command('exit').allowUnknownOption(true).action(() => process.exit()))
                                CLIProgram.parse(input.split(' '), {from: 'user'})//使用命令行传入的参数进行执行
                            } catch (e: any) {
                                DevNull(e)
                            }
                        })
                    onDestroy(() => {
                        inf.close()
                    })
                }),
                service: BuildServiceEntrypoint((module, handler, onDestroy) => {
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
                    onDestroy(async () => {
                        server.close()
                    })
                })
            }),
            docker: {
                class: Docker
            }
        },
        providers: {
            testProvider: {
                class: TestProvider,
                path: path.resolve('@test2', './hahahaha')
            },
            testProvider2: {
                class: TestProvider2
            },
            testProvider3: {
                class: TestProvider3,
                path: path.resolve('@test2', './hahahaha')
            }
        },
        modules: {
            testModule: {
                class: TestModule
            }
        },
        bootstrap: [
            // 'testModule',
            // 'testComponent',
            // 'testProvider',
            'entrypoint'
        ]
    }))
    .alias({
        '@test': path.resolve(__dirname, './xxxxx'),
        '@test2': '@test/kkkkkkkk'
    }, true)
    .onLaunched(async (app, log) => {
        // log.info('Application %s launched', app.appName)
        // console.log('MD5(\'test\').toString():', MD5('test').toString('base64'))
        // console.log('SHA1(\'test\').toString():', SHA1('test').toString('base64'))
        // console.log('SHA256(\'test\').toString():', SHA256('test').toString('base64'))

        const testProvider: TestProvider3 = await app.getObject('testProvider3')


        // const docker = await app.getObject<Docker>('docker')
        // const img=await docker.buildImage({
        //     dockerfile: 'TestDockerfile',
        //     files: ['TestDockerfile'],
        //     workdir: path.resolve(__dirname, '../../../src/tests/'),
        //     platform: 'linux/arm64',
        //     outputCallback: output => console.log(output)
        // })
        // await img.remove({force:true})
        // console.log('Docker image build and remove success')
        // console.log(await docker.listImages())
    })
    .onDone(async (app, log) => {
        log.info('Application %s done', app.appName)
    })
    .onFatalException((error, log) => {
        log.error('Application error: %s', error.message)
        return 100
    })
// .onUncaughtException((error, log) => {
//     log.error('Application uncaught error: %s', error.message)
// })

