import {DTO} from '../../lib/dto/DTO.js'
import {ClassDecorator} from '../../types/ClassDecorator.js'
import {setObjectIndexSignatureSchema} from '../../lib/dto/ObjectSchemaValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Accept in a DTO the string keys without an `@Expect` schema, validated against a schema: they are kept instead of
 * removed, and an invalid one fails the validation (on construction, on assignment, and in the class schema). Without
 * it, the keys without schema are removed. Subclasses inherit it. `FlexibleDTO` is a DTO accepting any key.
 * @param schema The schema of the value of each key without its own schema (`DTO.Any()` for any value).
 * @returns The class decorator.
 * @throws {InvalidValueException} From the DTO constructor, or from an assignment, when the value of a key without schema
 * does not match the schema.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect, IndexSignature} from 'lakutata/decorator/dto'
 *
 * //A device and its numeric readings, named freely
 * @IndexSignature(DTO.Number())
 * class ReadingsDTO extends DTO {
 *     [sensor: string]: any
 *
 *     @Expect(DTO.String().required())
 *     public device!: string
 * }
 *
 * const readings: ReadingsDTO = new ReadingsDTO({device: 'boiler', temperature: 61.5, pressure: 1.8})
 * console.log(readings.temperature)
 * ```
 */
export function IndexSignature<ClassConstructor extends typeof DTO>(schema: Schema): ClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => setObjectIndexSignatureSchema(target, schema)
}
