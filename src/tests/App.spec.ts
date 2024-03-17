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
import {Module} from '../lib/core/Module.js'
import {
    CLIEntrypointBuilder,
    CLIEntrypointHandler,
    HTTPEntrypointBuilder,
    HTTPEntrypointHandler, HTTPRouteMap, ServiceEntrypointBuilder
} from '../components/Entrypoint.js'
import {program} from 'commander'

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
                    console.log('routeMap:', routeMap)
                    const fastify = Fastify({
                        logger: false
                    })
                    routeMap.forEach((methods: Set<string>, route: string) => {
                        methods.forEach(method => {
                            fastify.route({
                                url: route,
                                method: <any>method,
                                handler: async (request, reply) => {
                                    return handler(new HTTPContext({
                                        route: request.routerPath,
                                        method: request.method,
                                        data: {...As<Record<string, string>>(request.query ? request.query : {}), ...As<Record<string, string>>(request.body ? request.body : {})}
                                    }))
                                }
                            })
                        })
                    })
                    fastify.listen({port: 3000, host: '0.0.0.0'})
                }),
                cli: CLIEntrypointBuilder((module: Module, handler: CLIEntrypointHandler) => {
                    console.log('ddddddddddd')
                    // console.log(program.option('--test111', 'this is a test').parse(process.argv))
                }),
                service: ServiceEntrypointBuilder((module, handler) => {
                    //TODO
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
