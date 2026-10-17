import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {Exception} from '../../lib/foundation/Exception.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {InvalidMethodAcceptException} from '../../exceptions/dto/InvalidMethodAcceptException.js'
import {VLD, VLDMethods} from '../../lib/validation/VLD.js'
import {SchemaConversionException} from '../../lib/validation/exceptions/SchemaConversionException.js'
import {SchemaDefinitionException} from '../../lib/validation/exceptions/SchemaDefinitionException.js'
import {SchemaException} from '../../lib/validation/exceptions/SchemaException.js'
import {SchemaValidationException} from '../../lib/validation/exceptions/SchemaValidationException.js'

class NamedDTO extends DTO {
    @Expect(DTO.String().min(2).required())
    public name: string
}

/**
 * The error thrown by a function
 * @param fn
 */
function thrown(fn: () => unknown): unknown {
    try {
        fn()
    } catch (e) {
        return e
    }
    throw new Error('Nothing thrown')
}

describe('Schema exceptions', (): void => {

    it('are framework exceptions', (): void => {
        const validation: unknown = (thrown((): unknown => VLDMethods.validate(1, VLD.string())) as InvalidValueException).cause
        assert.ok(validation instanceof SchemaValidationException)
        assert.ok(validation instanceof SchemaException)
        assert.ok(validation instanceof Exception)
        assert.strictEqual(validation.name, 'SchemaValidationException')
        assert.strictEqual(validation.errno, 'E_SCHEMA_VALIDATION')
        assert.strictEqual(validation.statusCode, 400)
        assert.strictEqual(validation.errMsg, validation.message)
        assert.ok(VLD.isError(validation))
    })

    it('report invalid schema definitions', (): void => {
        const definition: unknown = thrown((): unknown => VLD.string().min(-1))
        assert.ok(definition instanceof SchemaDefinitionException)
        assert.ok(definition instanceof SchemaException)
        assert.strictEqual(definition.errno, 'E_SCHEMA_DEFINITION')
        assert.strictEqual(definition.message, 'limit must be a positive integer or reference')
        const cycle: unknown = thrown((): unknown => VLD.object({a: VLD.ref('b'), b: VLD.ref('a')}))
        assert.ok(cycle instanceof SchemaDefinitionException)
        assert.ok(cycle.cause instanceof Error)
    })

    it('report schemas which cannot be converted', (): void => {
        class NotConvertible extends DTO {
        }

        Object.defineProperty(NotConvertible, 'Schema', {value: (): unknown => ({})})
        const conversion: unknown = thrown((): unknown => NotConvertible.toJsonSchema())
        assert.ok(conversion instanceof SchemaConversionException)
        assert.strictEqual(conversion.errno, 'E_SCHEMA_CONVERSION')
    })

    it('keep the validation details in the cause of InvalidValueException', async (): Promise<void> => {
        const sync: unknown = thrown((): unknown => VLDMethods.validate({name: 'x'}, VLD.object({name: VLD.string().min(2)})))
        assert.ok(sync instanceof InvalidValueException)
        //An error of the caller, as its cause
        assert.strictEqual(sync.statusCode, 400)
        assert.ok(sync.cause instanceof SchemaValidationException)
        assert.deepStrictEqual(sync.cause.details.map((detail) => detail.type), ['string.min'])
        const async: unknown = await VLDMethods.validateAsync({name: 'x'}, VLD.object({name: VLD.string().min(2)})).catch((e: unknown): unknown => e)
        assert.ok(async instanceof InvalidValueException)
        assert.ok(async.cause instanceof SchemaValidationException)
        const dto: unknown = thrown((): unknown => new NamedDTO({name: 'x'}))
        assert.ok(dto instanceof InvalidValueException)
        assert.ok(dto.cause instanceof InvalidValueException)
        assert.ok(dto.cause.cause instanceof SchemaValidationException)
    })

    it('are the cause of method validation exceptions', (): void => {
        class Service {
            @Accept(NamedDTO.required())
            public greet(input: NamedDTO): string {
                return input.name
            }
        }

        const accept: unknown = thrown((): unknown => new Service().greet(<NamedDTO>{name: 'x'}))
        assert.ok(accept instanceof InvalidMethodAcceptException)
        assert.ok(accept.cause instanceof InvalidValueException)
        assert.ok(accept.cause.cause instanceof SchemaValidationException)
    })
})
