import 'reflect-metadata'
import { Application,ApplicationOptions, DTO} from '../Core.js'
// import {Application} from '../lib/Application.js'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'
import {Validator} from '../Validator.js'
import {Accept} from '../Decorators.js'
import {SortArray, SortObject} from '../Utilities.js'

// console.log(Application)

// new Application({
//     id: 'test',
//     name: 'test'
//     // timezone: 'Asia/Shanghai'
// })


(async () => {
    console.log(await new Application({
        id: 'test',
        name: 'test'
        // timezone: 'Asia/Shanghai'
    }).test2({a: '1', b: 1, c: true}))
})()
