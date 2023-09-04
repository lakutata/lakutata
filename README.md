<div align="center">

![lakutata](https://socialify.git.ci/lakutata/lakutata/image?description=1&descriptionEditable=An%20IoC-based%20universal%20application%20framework&font=Source%20Code%20Pro&forks=1&language=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2Flakutata%2Flakutata%2Fmain%2Fassets%2Flogo.svg&name=1&pattern=Circuit%20Board&stargazers=1&theme=Auto)

</div>

<div align="center">

![node-lts](https://img.shields.io/node/v-lts/lakutata?style=for-the-badge&logo=nodedotjs&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/v/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/dm/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![NPM](https://img.shields.io/npm/l/lakutata?style=for-the-badge&logo=github&color=rgb(128%2C189%2C65))
![Codacy grade](https://img.shields.io/codacy/grade/0f16d1c355494415ad7733f8f22f7d36?style=for-the-badge&logo=codacy)

</div>

## Description

Lakutata is a generic development framework written in TypeScript and designed with IoC principles. Its main objective
is to provide a universal, efficient, and stable development framework. The design goals of Lakutata are not limited to
web application development; it aims to serve as a foundational framework for desktop applications, embedded systems
applications, and web applications. The framework primarily adopts an OOP (Object-Oriented Programming) approach and
encapsulates functionalities such as subprocesses, threads, permission management, and database ORM, enabling the
framework to be used out of the box.

In addition, Lakutata also supports the integration of third-party libraries into the application, allowing developers
to freely encapsulate and call third-party modules using Lakutata's dependency injection.

## Get Started

```typescript
import {AccessControl, Application, Container, Logger} from 'lakutata'
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
```

Click [Here](src/tests) for full example.

## License

Lakutata is [MIT licensed](LICENSE).
