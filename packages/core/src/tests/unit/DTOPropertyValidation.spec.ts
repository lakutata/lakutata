import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {IndexSignature} from '../../decorators/dto/IndexSignature.js'

class AddressDTO extends DTO {
    @Expect(DTO.String().min(2).required())
    public city: string

    @Expect(DTO.Number().uint16())
    public zip: number
}

class ProfileDTO extends DTO {
    @Expect(DTO.String().min(1).max(5).required())
    public name: string

    @Expect(DTO.Number().int8().allow(null))
    public age: number | null

    @Expect(DTO.Array().items(DTO.String().max(2)).max(2))
    public tags: string[]

    @Expect(DTO.String().valid('a', 'b').default('a'))
    public kind: string

    @Expect(AddressDTO.optional())
    public address: AddressDTO

    @Expect(DTO.Boolean().strip())
    public secret: boolean
}

class DependentDTO extends DTO {
    @Expect(DTO.Number().required())
    public min: number

    @Expect(DTO.Number().min(DTO.Ref('min')))
    public max: number
}

@IndexSignature(DTO.Number())
class IndexedDTO extends DTO {
    [key: string]: number

    @Expect(DTO.Number().required())
    public count: number
}

/**
 * The outcome of a validation: the value, or the error message
 * @param fn
 */
function outcome(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        return {value: fn()}
    } catch (e) {
        return {error: (e as Error).message}
    }
}

//Deterministic pseudo random numbers (mulberry32)
function random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('DTO property validation', (): void => {

    it('validates an assigned property like the whole object', (): void => {
        const rnd: () => number = random(20260927)
        const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)]
        const values: unknown[] = ['', 'a', 'abcdef', 'b', 1, 300, -129, null, undefined, true, ['a'], ['abc'], ['a', 'b', 'c'], {city: 'Paris'}, {city: 'P'}, {city: 'Paris', zip: 70000}, {}]
        const keys: string[] = ['name', 'age', 'tags', 'kind', 'address', 'secret', 'unknown']
        for (let i = 0; i < 2000; ++i) {
            const profile: ProfileDTO = new ProfileDTO({name: 'x', address: {city: 'Rome'}})
            const key: string = pick(keys)
            const value: unknown = pick(values)
            const before: string | undefined = JSON.stringify(profile[key])
            const expected: { value?: unknown, error?: string } = outcome((): unknown => JSON.stringify(DTO.validate({...profile, [key]: value}, ProfileDTO.Schema(), {noDefaults: true})[key]))
            const actual: { value?: unknown, error?: string } = outcome((): unknown => {
                profile[key] = value
                return JSON.stringify(profile[key])
            })
            assert.deepStrictEqual(actual, expected, `${key} = ${JSON.stringify(value)}`)
            //A rejected value keeps the previous one
            if (expected.error) assert.strictEqual(JSON.stringify(profile[key]), before)
        }
    })

    it('validates deletions and nested changes', (): void => {
        const profile: ProfileDTO = new ProfileDTO({name: 'x', address: {city: 'Rome'}, tags: ['a']})
        assert.throws((): void => {
            delete (profile as Record<string, unknown>).name
        }, {message: '"name" is required'})
        assert.strictEqual(profile.name, 'x')
        delete (profile as Record<string, unknown>).age
        assert.throws((): void => {
            profile.address.city = 'R'
        }, {message: '"address.city" length must be at least 2 characters long'})
        assert.strictEqual(profile.address.city, 'Rome')
        profile.address.zip = 1000
        assert.throws((): void => {
            profile.tags[1] = 'abc'
        }, {message: '"tags[1]" length must be less than or equal to 2 characters long'})
        assert.strictEqual(profile.tags[0], 'a')
    })

    it('validates the properties constrained together with the whole object', (): void => {
        const dependent: DependentDTO = new DependentDTO({min: 1, max: 5})
        assert.throws((): void => {
            dependent.min = 10
        }, {message: '"max" must be greater than or equal to ref:min'})
        assert.strictEqual(dependent.min, 1)
        const indexed: IndexedDTO = new IndexedDTO({count: 1})
        indexed.other = 2
        assert.throws((): void => {
            indexed.other = 'x' as unknown as number
        }, {message: '"other" must be a number'})
        const Generated: typeof DTO = DTO.fromJsonSchema({
            type: 'object',
            properties: {a: {type: 'number'}, b: {type: 'number'}},
            dependentRequired: {a: ['b']}
        })
        const generated: DTO = new Generated({b: 1})
        generated.a = 1
        assert.throws((): void => {
            delete generated.b
        })
    })
})
