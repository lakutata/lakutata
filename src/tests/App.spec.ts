import {__dirname, __filename} from '../lib/NodeCJS.js'
import {createRequire} from 'node:module'
import * as path from 'path'
import {MD5} from 'crypto-js'

(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 1000))
    console.log(1)
    await new Promise<void>(resolve => setTimeout(() => resolve(), 1000))
    console.log(__filename(import.meta))
    console.log(__dirname(import.meta))
    await new Promise<void>(resolve => setTimeout(() => resolve(), 1000))
    console.log(createRequire(__filename(import.meta)))
    if (true) {
        // const {Test} = await import(path.resolve(__dirname(import.meta), '../Test.js'))
        // Test()
        console.log(MD5('hahaha').toString())
        const xx = createRequire(__filename(import.meta))('../../../build/Release/lakutata.node')
        console.log(xx.hello1())
    }
})()
