import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import type {JSONSchema} from '../../types/JSONSchema.js'

/**
 * Whether a DTO class accepts a value
 * @param Class
 * @param value
 */
function accepts(Class: typeof DTO, value: Record<string, unknown>): boolean {
    try {
        new Class(value)
        return true
    } catch {
        return false
    }
}

class BaseModel extends DTO {
    public describeSelf(): string {
        return `${this.constructor.name}:${Object.keys(this).join(',')}`
    }
}

const USER: JSONSchema = {
    type: 'object',
    title: 'User',
    description: 'A user',
    properties: {
        id: {type: 'integer', format: 'int32'},
        name: {type: 'string', minLength: 1},
        role: {enum: ['admin', 'user'], default: 'user'},
        tags: {type: 'array', items: {type: 'string'}, uniqueItems: true}
    },
    required: ['id', 'name'],
    additionalProperties: false
}

const Account: typeof BaseModel = BaseModel.fromJsonSchema(USER, {name: 'Account'})

class Admin extends Account {
    @Expect(DTO.Boolean().required())
    public root: boolean
}

describe('DTO from JSON Schema', (): void => {

    it('creates a DTO class validating like the JSON Schema', (): void => {
        const User: typeof DTO = DTO.fromJsonSchema(USER)
        assert.strictEqual(User.name, 'User')
        const user: DTO = new User({id: 1, name: 'Alice'})
        assert.deepStrictEqual({...user}, {id: 1, name: 'Alice', role: 'user'})
        assert.ok(!accepts(User, {id: 1, name: 'Alice', extra: true}))
        assert.ok(!accepts(User, {id: '1', name: 'Alice'}))
        assert.ok(!accepts(User, {id: 2 ** 31, name: 'Alice'}))
        assert.ok(!accepts(User, {id: 1, name: 'Alice', tags: ['a', 'a']}))
        //The properties are validated when assigned
        assert.throws((): void => {
            user.name = ''
        })
        assert.strictEqual((User.Schema().describe() as { flags?: Record<string, unknown> }).flags?.description, 'A user')
    })

    it('extends the DTO class it is created from', (): void => {
        const user: BaseModel = new Account({id: 1, name: 'Alice'})
        assert.ok(user instanceof BaseModel)
        assert.strictEqual(user.describeSelf(), 'Account:id,name,role')
        //A generated class can be extended with decorated properties
        assert.ok(accepts(Admin, {id: 1, name: 'Root', root: true}))
        assert.ok(!accepts(Admin, {id: 1, name: 'Root'}))
    })

    it('keeps the object keywords and the subschemas of the object', (): void => {
        const Payment: typeof DTO = DTO.fromJsonSchema({
            type: 'object',
            properties: {method: {enum: ['card', 'cash']}, card: {type: 'string'}},
            required: ['method'],
            patternProperties: {'^x-': {type: 'string'}},
            propertyNames: {maxLength: 10},
            maxProperties: 3,
            if: {properties: {method: {const: 'card'}}},
            then: {required: ['card']}
        })
        assert.ok(accepts(Payment, {method: 'cash', 'x-note': 'n'}))
        assert.ok(!accepts(Payment, {method: 'card'}))
        assert.ok(accepts(Payment, {method: 'card', card: '4111'}))
        assert.ok(!accepts(Payment, {method: 'cash', 'x-note': 1}))
        assert.ok(!accepts(Payment, {method: 'cash', 'a-very-long-key': 1}))
        assert.ok(!accepts(Payment, {method: 'cash', a: 1, b: 2, c: 3}))
        assert.throws((): unknown => DTO.fromJsonSchema({type: 'string'}), {name: 'SchemaConversionException'})
    })

    it('creates the DTO classes of an OpenAPI document', (): void => {
        const classes: Record<string, typeof DTO> = DTO.fromOpenAPI({
            openapi: '3.0.3',
            components: {
                schemas: {
                    Pet: {type: 'object', properties: {name: {type: 'string'}, owner: {$ref: '#/components/schemas/Person'}}, required: ['name']},
                    Person: {type: 'object', properties: {age: {type: 'integer', minimum: 0, nullable: true}, friend: {$ref: '#/components/schemas/Person'}}},
                    Kind: {type: 'string', enum: ['cat', 'dog']}
                }
            }
        })
        assert.deepStrictEqual(Object.keys(classes), ['Pet', 'Person'])
        assert.ok(accepts(classes.Pet, {name: 'Tom', owner: {age: null, friend: {age: 3}}}))
        assert.ok(!accepts(classes.Pet, {name: 'Tom', owner: {friend: {age: -1}}}))
        assert.ok(!accepts(classes.Person, {age: 1.5}))
    })

    it('round trips through JSON Schema', (): void => {
        const User: typeof DTO = DTO.fromJsonSchema(USER)
        const Restored: typeof DTO = DTO.fromJsonSchema(User.toJsonSchema())
        for (const value of [{id: 1, name: 'A'}, {id: 1, name: ''}, {id: 1, name: 'A', role: 'guest'}, {id: 1, name: 'A', x: 1}, {id: 1.5, name: 'A'}]) {
            assert.strictEqual(accepts(Restored, value), accepts(User, value), JSON.stringify(value))
        }
        assert.deepStrictEqual(Restored.toJsonSchema(), User.toJsonSchema())
    })
})
