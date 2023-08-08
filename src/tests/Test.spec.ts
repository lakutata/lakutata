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
import {Stream, Writable} from 'stream'
import {AES128} from '../lib/crypto/aes/AES128.js'
import {AES192} from '../lib/crypto/aes/AES192.js'
import {AES256} from '../lib/crypto/aes/AES256.js'
import {TripleDES} from '../lib/crypto/des/TripleDES.js'
import {DES} from '../lib/crypto/des/DES.js'
import {ARIA128} from '../lib/crypto/aria/ARIA128.js'
import {ARIA192} from '../lib/crypto/aria/ARIA192.js'
import {ARIA256} from '../lib/crypto/aria/ARIA256.js'
import {CAMELLIA128} from '../lib/crypto/camellia/CAMELLIA128.js'
import {CAMELLIA192} from '../lib/crypto/camellia/CAMELLIA192.js'
import {CAMELLIA256} from '../lib/crypto/camellia/CAMELLIA256.js'

(async () => {

    // const str: string = 'this is test text!!!!'
    // const aes256 = new AES256(AES256.generateKey(), AES256.generateIV())
    // const encryptedMessage: string = aes256.encrypt(str)
    // console.log('encryptedMessage:', encryptedMessage)
    // const decryptedMessage: string = aes256.decrypt(encryptedMessage)
    // console.log('decryptedMessage:', decryptedMessage)

    // return
    
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
