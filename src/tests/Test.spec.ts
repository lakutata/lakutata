import 'reflect-metadata'
import {Application} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'
import {ConvertToStream, UniqueArray} from '../Utilities.js'
import {createHash, createHmac, getHashes, getCiphers} from 'crypto'
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
import {AES128} from '../lib/crypto/aes/AES128.js'
import {AES192} from '../lib/crypto/aes/AES192.js'
import {AES256} from '../lib/crypto/aes/AES256.js'
import {TripleDES} from '../lib/crypto/des/TripleDES.js'
import {DES} from '../lib/crypto/des/DES.js'

(async () => {
    // console.log(UniqueArray(getCiphers().map(value => value.split('-')[0])))
    // console.log(JSON.stringify(getCiphers()))


    // console.log(Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef', 'hex').length)
    // console.log(Buffer.from('0123456789abcdef', 'hex').length)
    // const aa = new DES(DES.generateKey())
    const aa = new DES(DES.generateKey(), DES.generateIV())
    // const aa = new AES128('nlOVmldyetfj4NEq', 'sJ75BQRFY2E9LKy9')
    // const aa = new AES128('nlOVmldyetfj4NEq', 'sJ75BQRFY2E9LKy9')
    const str = 'this is a text'

    const en = aa.encrypt(str)
    console.log(en)
    const de = aa.decrypt(en)
    console.log(de)

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
