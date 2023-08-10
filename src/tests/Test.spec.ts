import 'reflect-metadata'
import {Application} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'
import {ConvertToStream, UniqueArray} from '../Utilities.js'
import {
    createHash,
    createHmac,
    getHashes,
    getCiphers,
    createPublicKey,
    createPrivateKey,
    createSign,
    privateEncrypt
} from 'crypto'
import {
    HmacMD5,
    HmacRIPEMD160, HmacSM3,
    MD5,
    RIPEMD160,
    SHA1,
    SHA224,
    SHA256,
    SHA3,
    SHA384,
    SHA3_224, SHA3_256,
    SHA3_384, SHA3_512,
    SHA512, SM3
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
import {RSA} from '../lib/crypto/RSA.js'
import path, {dirname} from 'path'
import {fileURLToPath} from 'url'
import * as fs from 'fs'
import {createSecureContext} from 'tls'
import {SM2} from '../lib/crypto/SM2.js'

(async () => {

    // const str: string = 'this is test text!!!!'
    // const aes256 = new AES256(AES256.generateKey(), AES256.generateIV())
    // const encryptedMessage: string = aes256.encrypt(str)
    // console.log('encryptedMessage:', encryptedMessage)
    // const decryptedMessage: string = aes256.decrypt(encryptedMessage)
    // console.log('decryptedMessage:', decryptedMessage)
    //
    // return

    // console.log(await RSA.generateKeyPair())

    const msg: string = 'this is a test'

    // const rsaKeyPair = await RSA.generateKeyPair()
    //
    // const rsa = await RSA.loadKeyPair(rsaKeyPair)
    //
    // const pubRsa = await RSA.loadPublicKey(rsaKeyPair.publicKey)
    //
    // const privRsa = await RSA.loadPrivateKey(rsaKeyPair.privateKey)
    //
    // const encode: string = pubRsa.encrypt(msg)
    // console.log(encode)
    // const decode: string = privRsa.decrypt(encode)
    // console.log(decode)
    // const signed: string = privRsa.sign(msg)
    // console.log(signed)
    // console.log('verify:', pubRsa.verify(msg, signed))

    const sm2KeyPair = await SM2.generateKeyPair()
    // const sm2KeyPair = {
    //     publicKey: '046a989788317180e13460fa41f8f4e971c05937e94ef226352257feffccf26269fb099da67e22fb4883abe600f7348af2f9b4ca79340f02e16a48a950fae79bb9',
    //     privateKey: '697f700a46342fe7d162a7cb5d65a7ff4af7a21dae0ef27b91dbd07bbb7543bc'
    // }


    const sm2 = await SM2.loadKeyPair(sm2KeyPair)
    //
    const pubSm2 = await SM2.loadPublicKey(sm2KeyPair.publicKey)
    //
    const privSm2 = await SM2.loadPrivateKey(sm2KeyPair.privateKey)
    //

    const encode: string = pubSm2.encrypt(msg)
    console.log('encode:',encode)
    const decode: string = privSm2.decrypt(encode)
    console.log('decode:',decode)
    const signed: string = privSm2.sign(msg)
    console.log(signed)
    console.log('verify:', pubSm2.verify(msg, signed))


    // const app = await Application.run({
    //     id: 'test',
    //     name: 'test',
    //     timezone: 'Asia/Shanghai',
    //     mode: 'production',
    //     entries: {
    //         testComponent: {class: TestComponent, lifetime: 'SINGLETON', config: {greet: 'hello world'}},
    //         testObject: {class: TestObject, lifetime: 'SINGLETON', config: {username: 'tester'}},
    //         testInterval: {
    //             class: TestInterval,
    //             lifetime: 'SINGLETON',
    //             config: {
    //                 interval: 1000,
    //                 mode: 'SEQ'
    //             }
    //         }
    //         // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
    //         //     lifetime: 'SINGLETON',
    //         //     config: {tester: 'this is tester'}
    //         // }
    //     },
    //     modules: {
    //         tm: {class: TestModule1, config: {greet: 'oh!'}},
    //         tm1: TestModule1
    //     },
    //     bootstrap: [
    //         'tm',
    //         'tm1',
    //         'testInterval',
    //         async (app: Application) => {
    //             console.log('app.mode():', app.mode())
    //         }
    //     ]
    // })
    // // app.exit()
})()
