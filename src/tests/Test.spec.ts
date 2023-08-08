import 'reflect-metadata'
import {Application} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'
import {ConvertToStream} from '../Utilities.js'
import {createHash, createHmac, getHashes} from 'crypto'
import {
    HmacMD5,
    HmacRIPEMD160,
    MD5,
    RIPEMD160,
    SHA1,
    SHA224,
    SHA256,
    SHA3,
    SHA384,
    SHA3_224, SHA3_256,
    SHA3_384, SHA3_512,
    SHA512
} from '../Hash.js'
import {Stream} from 'stream'

(async () => {

    const str: string = 'this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!this is a test!'
    const key: string = 'key123456'
    function* stringToIterable(str:any):Generator<string> {
        for (let i = 0; i < str.length; i++) {
            yield str[i];
        }
    }
    Stream.Readable.from(stringToIterable(str), {highWaterMark: 1}).on('data',(data)=>{
        console.log('data!!!!',data)
    })
    // console.log(getHashes())

    console.log('MD5', await MD5(str, true))
    console.log('MD5', MD5(str))
    // console.log('SHA1', await SHA1(str, true))
    // console.log('SHA256', await SHA256(str, true))
    // console.log('SHA224', await SHA224(str, true))
    // console.log('SHA512', await SHA512(str, true))
    // console.log('SHA384', await SHA384(str, true))
    // console.log('SHA3_224', await SHA3_224(str, true))
    // console.log('SHA3_256', await SHA3_256(str, true))
    // console.log('SHA3_384', await SHA3_384(str, true))
    // console.log('SHA3_512', await SHA3_512(str, true))
    // console.log('RIPEMD160', await RIPEMD160(str, true))

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
