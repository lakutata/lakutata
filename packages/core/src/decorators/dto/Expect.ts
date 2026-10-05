import {DTO} from '../../lib/dto/DTO.js'
import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {setObjectPropertySchema} from '../../lib/dto/ObjectSchemaValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Declare the schema of a property of a DTO class. The DTO validates the property against it when it is constructed
 * (the whole object at once: defaults applied, the keys without schema removed unless the class has an
 * `@IndexSignature`), and each time the property, or a value nested in it, is changed afterwards (the change is undone
 * when invalid). The schema is also part of the class schema (`MyDTO.Schema()`) used by `@Accept`, `@Return` and the
 * actions' input validation. Subclasses inherit the property schemas, and may declare a property again to replace its
 * schema. Ignored on a symbol property or on a class which is not a DTO.
 * @param schema The schema of the property, built with the static methods of `DTO` (`DTO.String().required()`); a
 * property is optional unless its schema is marked `required()`.
 * @returns The property decorator.
 * @throws {InvalidValueException} From the DTO constructor, or from an assignment to the property, when the value does
 * not match the schema.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect} from 'lakutata/decorator/dto'
 *
 * class CreateUserDTO extends DTO {
 *     @Expect(DTO.String().min(2).max(50).required())
 *     public name!: string
 *
 *     @Expect(DTO.String().email().required())
 *     public email!: string
 *
 *     @Expect(DTO.Number().integer().min(0).optional().default(0))
 *     public credits?: number
 * }
 *
 * //Validated when constructed: credits is 0, an invalid email throws an InvalidValueException
 * const user: CreateUserDTO = new CreateUserDTO({name: 'Ada', email: 'ada@example.com'})
 * //Validated when changed: throws an InvalidValueException, the name is unchanged
 * user.name = 'A'
 * ```
 */
export function Expect<ClassPrototype extends DTO>(schema: Schema): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol): void => setObjectPropertySchema(target, propertyKey, schema)
}
