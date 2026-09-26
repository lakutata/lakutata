import {describe, it} from 'node:test'
import assert from 'node:assert'
import {isClass} from '../../lib/ioc/Utils.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Container} from '../../lib/core/Container.js'
import {IsSubclassOf} from '../../lib/helpers/internal/IsSubclassOf.js'
import {DTO} from '../../lib/core/DTO.js'

class SubObject extends BaseObject {
}

await describe('IoC Test', async function (): Promise<void> {
    await it('isClass() recognizes classes and constructor functions only', async (): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-extraneous-class
        class Plain {
        }

        function LegacyConstructor(): void {
        }

        function helper(): void {
        }

        assert.equal(isClass(Plain), true, 'class')
        assert.equal(isClass(SubObject), true, 'derived class')
        assert.equal(isClass(class {
        }), true, 'anonymous class')
        assert.equal(isClass(LegacyConstructor), true, 'capitalized ES5 constructor function')
        assert.equal(isClass(Date), true, 'built-in constructor')
        assert.equal(isClass(helper), false, 'plain function')
        assert.equal(isClass((): void => undefined), false, 'arrow function')
        assert.equal(isClass(async function Capitalized(): Promise<void> {
        }), false, 'async function')
        assert.equal(isClass(As(undefined)), false, 'not a function')
    })

    await it('builds an object without a registration', async (): Promise<void> => {
        const root: Container = new Container()
        const built: SubObject = await root.build(SubObject)
        assert.ok(built instanceof SubObject)
        await root.destroy()
    })

    await it('IsSubclassOf() gives the same result as DTO.Class() validation', async (): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-extraneous-class
        class Unrelated {
        }

        const values: unknown[] = [BaseObject, SubObject, class extends SubObject {
        }, Unrelated, Date, (): void => undefined, function helper(): void {
        }, new Unrelated(), {}, null, 'BaseObject', 1]
        for (const value of values) assert.equal(IsSubclassOf(value, BaseObject), DTO.isValid(value, DTO.Class(BaseObject)), String(value))
        //Joi treats undefined as "not provided" and accepts it, but undefined is no subclass (no call site passes it)
        assert.equal(IsSubclassOf(undefined, BaseObject), false)
    })
})

function As<T>(value: unknown): T {
    return value as T
}
