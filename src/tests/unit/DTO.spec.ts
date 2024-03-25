import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {Return} from '../../decorators/dto/Return.js'
import {DevNull} from '../../lib/functions/DevNull.js'

export default async function () {
    await describe('DTO Test', async function (): Promise<void> {
        await it('validate string', async (): Promise<void> => {
            assert.equal(DTO.validate('test-string', DTO.String()), 'test-string')
            assert.throws(() => DTO.validate(12345, DTO.String()))
        })
        await it('validate number', async (): Promise<void> => {
            assert.equal(DTO.validate(123456, DTO.Number()), 123456)
            assert.throws(() => DTO.validate('12345', DTO.Number()))
        })
        await it('validate boolean', async (): Promise<void> => {
            assert.equal(DTO.validate(true, DTO.Boolean()), true)
            assert.throws(() => DTO.validate('true', DTO.Boolean()))
        })
        await it('validate object', async (): Promise<void> => {
            const obj: object = {}
            assert.equal(DTO.validate(obj, DTO.Object()), obj)
            assert.throws(() => DTO.validate('object', DTO.Object()))
        })
        await it('validate symbol', async (): Promise<void> => {
            const symbol: symbol = Symbol('test symbol')
            assert.equal(DTO.validate(symbol, DTO.Symbol()), symbol)
            assert.throws(() => DTO.validate('symbol', DTO.Symbol()))
        })
        await it('validate function', async (): Promise<void> => {
            const func: Function = function (): void {
            }
            assert.equal(DTO.validate(func, DTO.Function()), func)
            assert.throws(() => DTO.validate('func', DTO.Function()))
        })
        await it('validate array', async (): Promise<void> => {
            const arr: any[] = ['a', 'b', 'c']
            assert.equal(DTO.isValid(arr, DTO.Array(DTO.String())), true)
            assert.throws(() => DTO.validate(['str', 1, 2, 3], DTO.Array(DTO.String())))
        })
        await it('simple DTO object test', async (): Promise<void> => {
            class SimpleDTO extends DTO {
                @Expect(DTO.String().required())
                public test1: string

                @Expect(DTO.Number().required())
                public test2: number

                @Expect(DTO.Boolean().required())
                public test3: boolean
            }

            const validInput: Record<string, any> = {
                test1: 'abcdefg',
                test2: 123456,
                test3: true
            }
            const invalidInput: Record<string, any> = {
                test1: 'abcdefg',
                test2: '123456',
                test3: true
            }
            assert.doesNotThrow(() => new SimpleDTO(validInput))
            assert.throws(() => new SimpleDTO(invalidInput))
            assert.equal(SimpleDTO.isValid(validInput), true)
            assert.equal(SimpleDTO.isValid(invalidInput), false)
        })
        await it('embed DTO object test', async (): Promise<void> => {
            class EmbedDTO extends DTO {
                @Expect(DTO.String().not('rab').required())
                public foo: any
            }

            class TestDTO extends DTO {
                @Expect(EmbedDTO.required())
                public embed: EmbedDTO

                @Expect(DTO.String().default('world'))
                public hello: string
            }

            const validInput: Record<string, any> = {
                embed: {
                    foo: 'bar'
                }
            }
            const invalidInput: Record<string, any> = {
                embed: {
                    foo: 123456
                }
            }
            assert.doesNotThrow(() => new TestDTO(validInput))
            assert.throws(() => new TestDTO(invalidInput))
            assert.throws(() => new TestDTO(validInput).embed.foo = 'rab')
            assert.throws(() => delete new TestDTO(validInput).embed.foo)
            assert.equal(TestDTO.isValid(validInput), true)
            assert.equal(TestDTO.isValid(invalidInput), false)
            assert.equal(new TestDTO(validInput).embed.foo, 'bar')
        })
        await it('extend DTO object test', async (): Promise<void> => {
            class Test1DTO extends DTO {
                @Expect(DTO.String().required())
                public a: string

                @Expect(DTO.Number().required())
                public b: number

                @Expect(DTO.Number().optional())
                public common: any
            }

            class Test2DTO extends Test1DTO {
                @Expect(DTO.String().required())
                public c: string

                @Expect(DTO.Number().required())
                public d: number

                @Expect(DTO.String().required())
                public common: any
            }

            const validInput: Record<string, any> = {
                a: 'a',
                b: 1,
                c: 'c',
                d: 2,
                common: 'common'
            }
            const invalidInput: Record<string, any> = {
                a: 'a',
                b: '1',
                c: 'c',
                d: '2',
                common: 'common'
            }
            assert.doesNotThrow(() => new Test2DTO(validInput))
            assert.throws(() => new Test2DTO(invalidInput))
        })
        await it('validate class method\'s input arguments', async (): Promise<void> => {
            class TestDTO extends DTO {
                @Expect(DTO.String().required())
                public name: string

                @Expect(DTO.Number().required())
                public age: number

                @Expect(DTO.String().optional().default('unknown'))
                public gender: string
            }

            class TestClass {
                @Accept(TestDTO.required())
                public testAccept(inp: TestDTO): string {
                    DevNull(inp)
                    return 'OK'
                }
            }

            const validInput: Record<string, any> = {
                name: 'alex',
                age: 18
            }

            const invalidInput: Record<string, any> = {
                name: 'alex',
                age: 'unknown'
            }

            assert.throws(() => new TestClass().testAccept(<TestDTO>invalidInput))
            assert.doesNotThrow(() => new TestClass().testAccept(<TestDTO>validInput))
            assert.equal(new TestClass().testAccept(<TestDTO>validInput), 'OK')
        })
        await it('validate class method\'s return value', async (): Promise<void> => {
            class TestDTO extends DTO {
                @Expect(DTO.String().required())
                public name: string

                @Expect(DTO.Number().required())
                public age: number

                @Expect(DTO.String().optional().default('unknown'))
                public gender: string
            }

            class TestClass {
                @Return(TestDTO.required())
                public testReturn(out: any): TestDTO {
                    return out
                }
            }

            const validOutput: Record<string, any> = {
                name: 'alex',
                age: 18
            }

            const invalidOutput: Record<string, any> = {
                name: 'alex',
                age: 'unknown'
            }

            assert.throws(() => new TestClass().testReturn(invalidOutput))
            assert.doesNotThrow(() => new TestClass().testReturn(validOutput))
            assert.equal(new TestClass().testReturn(validOutput).gender, 'unknown')
        })
    })

}
