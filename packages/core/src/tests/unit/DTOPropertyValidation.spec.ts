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

@IndexSignature(DTO.Any())
class ContextDTO extends DTO {
    @Expect(DTO.Any())
    public request: any
}

/**
 * An object of a class whose getter reads a private field, as a transport object of a context
 */
class Member {
    #name: string = 'alice'

    public get name(): string {
        return this.#name
    }
}

/**
 * An object of a class with a property a schema checks
 */
class Address {
    constructor(public city: unknown) {
    }
}

class CustomerDTO extends DTO {
    @Expect(DTO.Object({city: DTO.String().required()}).required())
    public address: Address

    @Expect(DTO.Any().custom((value: Address): Address => {
        if (value.city !== 'Paris') throw new Error('only Paris')
        return value
    }))
    public place: Address

    @Expect(DTO.Any().when('place', {is: DTO.Any().exist(), then: DTO.Any().invalid(null)}))
    public conditional: Address

    @Expect(DTO.Any().invalid('none'))
    public excluded: Address
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
        //A rejected new item leaves no hole
        assert.deepStrictEqual(JSON.parse(JSON.stringify(profile.tags)), ['a'])
        assert.strictEqual(profile.tags.length, 1)
        //A rejected nested deletion restores the property
        assert.throws((): void => {
            delete (profile.address as Record<string, unknown>).city
        }, {message: '"address.city" is required'})
        assert.strictEqual(profile.address.city, 'Rome')
    })

    it('validates the changes of the array methods', (): void => {
        const profile: ProfileDTO = new ProfileDTO({name: 'x', tags: ['a']})
        assert.throws((): void => {
            profile.tags.push('abc')
        }, {message: '"tags[1]" length must be less than or equal to 2 characters long'})
        assert.deepStrictEqual(JSON.parse(JSON.stringify(profile.tags)), ['a'])
        assert.throws((): void => {
            profile.tags.push('b', 'c')
        }, {message: '"tags" must contain less than or equal to 2 items'})
        assert.strictEqual(profile.tags.length, 1)
        assert.strictEqual(profile.tags.push('b'), 2)
        profile.tags.reverse()
        assert.deepStrictEqual(JSON.parse(JSON.stringify(profile.tags)), ['b', 'a'])
        assert.throws((): void => {
            profile.tags.splice(0, 1, 'abc')
        })
        assert.deepStrictEqual(JSON.parse(JSON.stringify(profile.tags)), ['b', 'a'])
        assert.strictEqual(profile.tags.pop(), 'a')
        //The steps of a method are not validated: a sort of unique items goes through duplicates
        class UniqueDTO extends DTO {
            @Expect(DTO.Array().items(DTO.Number()).unique())
            public list: number[]
        }

        const unique: UniqueDTO = new UniqueDTO({list: [3, 1, 2]})
        unique.list.sort()
        assert.deepStrictEqual(JSON.parse(JSON.stringify(unique.list)), [1, 2, 3])
        assert.throws((): void => {
            unique.list.fill(0)
        })
        assert.deepStrictEqual(JSON.parse(JSON.stringify(unique.list)), [1, 2, 3])
    })

    it('keeps the functions of the nested objects working, with their own properties', (): void => {
        //A function with methods of its own, as an express application: its own bind registers a route
        const app: any = function (): void {
        }
        app.settings = {trust: 'yes'}
        app.get = function (this: any, key: string): string {
            return this.settings[key]
        }
        app.bind = (): never => {
            throw new Error('The own bind of the function was called')
        }
        //A getter reading the application, as the ip of an express request
        const request: any = {
            app: app,
            born: new Date(0),
            get trust(): string {
                return this.app.get('trust')
            }
        }
        const context: ContextDTO = new ContextDTO({request: request})
        assert.strictEqual(context.request.trust, 'yes')
        assert.strictEqual(context.request.app.settings.trust, 'yes')
        assert.strictEqual(context.request.app(), undefined)
        //The methods are called on their object: the internal slots of a Date
        assert.strictEqual(context.request.born.getTime(), 0)
    })

    it('gives the objects of other classes held by a property accepting any value as they are', (): void => {
        const member: Member = new Member()
        const connections: WeakMap<Member, string> = new WeakMap([[member, 'its connection']])
        //A property DTO.Any(), and undeclared properties of the index signature DTO.Any(), as the transport objects of
        //a context
        const context: ContextDTO & Record<string, any> = new ContextDTO({
            request: {member: member},
            member: member,
            map: new Map([['a', 1]]),
            set: new Set([1, 2])
        })
        assert.strictEqual(context.member.name, 'alice')
        assert.strictEqual(context.member, member)
        assert.strictEqual(connections.get(context.member), 'its connection')
        assert.strictEqual(context.map.size, 1)
        assert.strictEqual(context.set.size, 2)
        //In a plain object of such a property too, which is still proxied
        assert.strictEqual(context.request.member.name, 'alice')
        assert.strictEqual(context.request.member, member)
        assert.notStrictEqual(context.request, context.request)
        //A DTO held there is given as it is too, and still validates its changes itself
        const address: AddressDTO = new AddressDTO({city: 'Paris'})
        const holding: ContextDTO = new ContextDTO({request: address})
        assert.strictEqual(holding.request, address)
        assert.throws((): void => {
            holding.request.city = 1
        })
        assert.strictEqual(holding.request.city, 'Paris')
    })

    it('validates the changes nested in an object of another class held by a property whose schema checks it', (): void => {
        const customer: CustomerDTO = new CustomerDTO({address: new Address('Paris'), place: new Address('Paris')})
        assert.throws((): void => {
            customer.address.city = 123
        }, {message: '"address.city" must be a string'})
        assert.strictEqual(customer.address.city, 'Paris')
        //An any schema with a rule may refuse a change
        assert.throws((): void => {
            customer.place.city = 'Lyon'
        })
        assert.strictEqual(customer.place.city, 'Paris')
        //An any schema with a condition or a value refused still watches the objects it holds
        const watched: CustomerDTO = new CustomerDTO({address: new Address('Paris'), conditional: new Address('Paris'), excluded: new Address('Paris')})
        assert.notStrictEqual(watched.conditional, watched.conditional)
        assert.notStrictEqual(watched.excluded, watched.excluded)
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
