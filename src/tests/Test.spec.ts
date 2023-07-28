import {Application} from '../Core.js'
import pupa from 'pupa'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'
import {DTO} from '../lib/base/DTO.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

(async () => {
    // console.log(await new Application({
    //     id: 'test',
    //     name: 'test',
    //     timezone: 'Asia/Shanghai'
    // }).test({a: '1', b: 'dddddd', dd: 11}, '11', true))

    console.log(await new Application({
        id: 'test',
        name: 'test',
        // timezone: 'Asia/Shanghai'
    }).test2({a: '1', b: 1, c: true}))

    class YY extends DTO {
        @Accept(Validator.String())
        public aa: string

        @Accept(Validator.String().required())
        public cc?: string

        @Accept(Validator.String().default('uuuu'))
        public dd?: string

        @Accept(Validator.Number().required())
        public pp: number
    }

    class XX extends DTO {

        @Accept(Validator.Number().required())
        public bb

        @Accept(YY.schema().required())
        public xx: YY

    }

    class BB {
        @Accept(XX)
        public test(opt: XX) {
            console.log('test output:', opt)
        }
    }

    // const test = YY.concat(XX)

    // console.log(YY.validate({aa: 'gggggg'},{stripUnknown:false}))
    // console.log(await YY.validateAsync({aa: 'gggggg'}))
    // YY.validate()
    // console.log(YY.schema().validate({aa:'aaaaa'}))

    const data1: any = {aa: 'aaa', cc: 'eeeee', pp: 1, bb: 1}
    const data2: any = {bb: 1, xx: {aa: 'aaa', cc: 'eeeee', pp: 1}}

    // console.log(XX.schema())

    // new BB().test(data)
    // console.log('validate output:', await YY.validateAsync(data))
    console.log('validate output:', await XX.validateAsync(data2))

    // console.error(new InvalidMethodAcceptException('I love {a} and {b}', {a: 'bb', b: 'mm'}))
})()
