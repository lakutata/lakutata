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
import path from 'node:path'
import {Delay} from '../lib/functions/Delay.js'
import {createWriteStream} from 'node:fs'
import {Library} from '../lib/ffi/Library.js'
import {
    BuildDockerHttpConnectionConfig,
    BuildDockerSocketConnectionConfig,
    Docker
} from '../components/Docker.js'
import {pipeline} from 'stream/promises'
import {platform} from 'node:os'
import {rm} from 'node:fs/promises'

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
            docker: (() => {
                switch (platform()) {
                    case 'win32':
                        return BuildDockerHttpConnectionConfig({
                            host: 'localhost',
                            port: 2375
                        })
                    default:
                        return BuildDockerSocketConnectionConfig({
                            socketPath: '/var/run/docker.sock'
                        })
                }
            })()
        },
        providers: {
            testProvider: {
                class: TestProvider,
                path: path.resolve('@test2', './hahahaha')
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
            // 'testModule',
            // 'testComponent',
            // 'testProvider',
            // 'entrypoint'
        ]
    }))
    .alias({
        '@test': path.resolve(__dirname, './xxxxx'),
        '@test2': '@test/kkkkkkkk'
    }, true)
    .onLaunched((app, log) => {
        log.info('Application %s launched', app.appName)
        // const lib = new Library('/Users/alex/libfactorial.dylib')
        // const offset = lib.symbol('offset', 'int')
        // offset.value = 8
        // const func = lib.func('uint64_t factorial(int max)')
        // console.log('ffi test:', func(3), offset.value)
    })
    .onLaunched(async (app, logger) => {
        const docker = await app.getObject<Docker>('docker')
        // console.log(await docker.listImages())
        // await docker.pull('ubuntu',{},{})
        // console.log('done')
        //C:\Users\Administrator\Desktop\test
        const image = await docker.buildImage({
            // context: '/Users/alex/Desktop/test',
            context: '/Users/Administrator/Desktop/test',
            src: ['Dockerfile']
        }, {
            t: 'abcddd:llllllll',
            dockerfile: 'Dockerfile',
            platform: 'linux/arm64'
            // platform: 'linux/amd64'
        }, output => console.log(output))
        const exportFilename: string = '/Users/Administrator/Desktop/testImage.tar'
        await rm(exportFilename, {force: true, recursive: true})
        await image.export(exportFilename)
        await image.remove()
        // await Delay(20000)
        const newImage = await docker.importImage(exportFilename)
        // const dockerContainer = await docker.run(newImage.id, ['/bin/sh','node', '-e', '"setInterval(()=>{},1000)"'])
        const dockerContainer = await docker.run(newImage.id, ['/bin/bash', '-c', 'node -e "setInterval(()=>{console.log(Date.now())},1000)"'])
        // const logs = await dockerContainer.logs({stdout: true, stderr: true, follow: true})
        await Delay(10000)
        // const logs = await dockerContainer.logs({stdout: true, stderr: true, follow: false})
        // console.log(logs.toString())
        const {duplex, resize} = await dockerContainer.tty({Cmd: ['/bin/bash']})
        process.stdin.pipe(duplex)
        duplex.pipe(process.stdout)
        const [width, height] = process.stdout.getWindowSize()
        resize({width: width, height: height})
        // console.log(await dockerContainer.stats({stream: false}))
        // console.log('export done')
        // await Delay(10000)
        // const res = await docker.importImage('/Users/alex/testImage2.tar')
        // res.pipe(process.stdout)
        // console.log('done')
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

