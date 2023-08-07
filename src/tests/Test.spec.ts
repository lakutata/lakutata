import 'reflect-metadata'
import {Application} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'
import {ConvertToStream} from '../Utilities.js'
import {createHash, createHmac} from 'crypto'
import {MD5, RIPEMD160} from '../Hash.js'

(async () => {

    const str: string = 'this is a test'
    const key: string = 'key123456'

    // const hmac=createHmac('md5',key)
    // hmac.on('readable', ()=>{
    //     const data=hmac.read()
    //     if(data){
    //         console.log(data.toString('hex'))
    //     }
    // })
    // hmac.write(str)
    //
    // hmac.end()
    // console.log(hmac.digest().toString('hex'))


    // const hash=createHash('RIPEMD160')
    //
    // ConvertToStream(str).on('data', data=>{
    //     hash.update(data)
    // }).on('end', ()=>{
    //     console.log(MD5(str))
    //     console.log(hash.digest().toString('hex'))
    // })
    return
    const app = await Application.run({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        mode: 'production',
        entries: {
            testComponent: {class: TestComponent, lifetime: 'SINGLETON', config: {greet: 'hello world'}},
            testObject: {class: TestObject, lifetime: 'SINGLETON', config: {username: 'tester'}},
            testInterval: {
                class: TestInterval,
                lifetime: 'SINGLETON',
                config: {
                    interval: 1000,
                    mode: 'SEQ'
                }
            }
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //     lifetime: 'SINGLETON',
            //     config: {tester: 'this is tester'}
            // }
        },
        modules: {
            tm: {class: TestModule1, config: {greet: 'oh!'}},
            tm1: TestModule1
        },
        bootstrap: [
            'tm',
            'tm1',
            'testInterval',
            async (app: Application) => {
                console.log('app.mode():', app.mode())
            }
        ]
    })
    // app.exit()
})()
