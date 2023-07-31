import {Application, DTO} from '../Core.js'
import pupa from 'pupa'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'
import {Validator} from '../Validator.js'
import {Accept} from '../Decorators.js'
import {SortArray} from '../Utilities.js'

(async () => {
    // console.log(await new Application({
    //     id: 'test',
    //     name: 'test',
    //     timezone: 'Asia/Shanghai'
    // }).test({a: '1', b: 'dddddd', dd: 11}, '11', true))


    // console.log(await new Application({
    //     id: 'test',
    //     name: 'test'
    //     // timezone: 'Asia/Shanghai'
    // }).test2({a: '1', b: 1, c: true}))

    const arr: { a: string, b: number, c: boolean }[] = [{a: '1', b: 1, c: true}, {a: '1', b: 2, c: true}, {
        a: '3',
        b: 3,
        c: true
    }, {a: '4', b: 4, c: true}, {a: '5', b: 5, c: true}, {a: '6', b: 6, c: true}]

    // SortArray(arr, {computed: {test: (item) => item.c}})
    console.log(SortArray(arr, {
        by: 'a',
        order: 'asc'
    }, {by: 'b', order: 'desc'}))

})()
