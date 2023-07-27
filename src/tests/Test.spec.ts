import {Application} from '../Core.js'
import pupa from 'pupa'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'

(async () => {
    console.log(await new Application({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai'
    }).test({a: '1', b: 'dddddd', dd: 11}, '11', true))

    // console.error(new InvalidMethodAcceptException('I love {a} and {b}', {a: 'bb', b: 'mm'}))
})()
