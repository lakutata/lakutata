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
    privateEncrypt, randomBytes
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
import {PassThrough, Stream, TransformCallback, Writable} from 'stream'
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
import {createReadStream} from 'fs'
import CryptoJs from 'crypto-js'
import {BufferEncoding} from 'object-hash'

(async () => {


    const key: Buffer = Buffer.from('b0c5d001bc5091d0a448d7e2138a0cd2', 'hex')
    const iv: Buffer = Buffer.from('6b6c5906aeb4fbf38e10dc616f569d10', 'hex')

    // createReadStream('/Users/alex/WebstormProjects/core/build/chunk-2G7VYCFF.js', {encoding: 'utf-8'}).pipe(new AES128(key, iv).Cipher).pipe(new AES128(key, iv).Decipher)
    // .pipe(process.stdout)

    const aes128Key:Buffer=Buffer.from('98dd7bfc597314c6612bfc50043d4b50','hex')
    const aes128IV:Buffer=Buffer.from('ed76235ed4bfcf02ee0fe892c31eb48e','hex')
    const aes128 = new AES128(aes128Key, aes128IV)
    const aes128_encrypt = aes128.encrypt('hello world')
    console.log('aes128 encrypt:', aes128_encrypt)//121d6887d0acfa63103fccfb828600a7
    const aes128_decrypt = aes128.decrypt(aes128_encrypt)
    console.log('aes128 decrypt:', aes128_decrypt)


    const aes192Key:Buffer=Buffer.from('2f61c2c3ce7a330b161d5911a2f86e892a0926c9ebadfbd7','hex')
    const aes192IV:Buffer=Buffer.from('60ba4efe5c64c37f0d9c7acf0e4ab8ad','hex')
    const aes192 = new AES192(aes192Key, aes192IV)
    const aes192_encrypt = aes192.encrypt('hello world')
    console.log('aes192 encrypt:', aes192_encrypt)//f01bc324690e5187db25585acf326fe4
    const aes192_decrypt = aes192.decrypt(aes192_encrypt)
    console.log('aes192 decrypt:', aes192_decrypt)

    const aes256Key:Buffer=Buffer.from('4e8207bc325e99ae0418fae89d3f3a1c42d991148dc7d4fea6b3b7b34b3abae8','hex')
    const aes256IV:Buffer=Buffer.from('73e4ca8af64db89378dd431094840fa9','hex')
    const aes256 = new AES256(aes256Key, aes256IV)
    const aes256_encrypt = aes256.encrypt('hello world')
    console.log('aes256 encrypt:', aes256_encrypt)//8d0c283782eb036d023d64b3cc0b52dd
    const aes256_decrypt = aes256.decrypt(aes256_encrypt)
    console.log('aes256 decrypt:', aes256_decrypt)

    const desKey:Buffer=Buffer.from('aeb0e51f86bfbfcd5775cb53ef5a3315','hex')
    const desIV:Buffer=Buffer.from('204a2e22b5473d8e','hex')
    const des = new DES(desKey, desIV)
    const des_encrypt = des.encrypt('hello world')
    console.log('des encrypt:', des_encrypt)//388479435155f5eab2c682e58151a5d5
    const des_decrypt = des.decrypt(des_encrypt)
    console.log('des decrypt:', des_decrypt)

    const des3Key:Buffer=Buffer.from('77e3737aa085375905f305f45369882305418fdce51b7214','hex')
    const des3IV:Buffer=Buffer.from('725cf8e27fb54304','hex')
    const des3 = new TripleDES(des3Key, des3IV)
    const des3_encrypt = des3.encrypt('hello world')
    console.log('des3 encrypt:', des3_encrypt)//a2dda9669f2574e033b371387073c665
    const des3_decrypt = des3.decrypt(des3_encrypt)
    console.log('des3 decrypt:', des3_decrypt)

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
    // app.exit()
})()
