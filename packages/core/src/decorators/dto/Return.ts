import {DTO} from '../../lib/dto/DTO.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {setMethodReturnValueValidator} from '../../lib/dto/MethodValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Validate the result of each call of the method (awaited for an async method) against a schema; the caller then
 * receives the validated value (defaults applied, the keys without schema removed). A DTO class validates the result
 * against its schema: the caller receives a plain object. The schema is also published for the entrypoints describing
 * the results of their actions (see `getMethodReturnSchema`).
 * @param def The schema of the result: a DTO class or a schema (`DTO.Number()`).
 * @returns The method decorator; the decorated method cannot be reassigned.
 * @throws {InvalidMethodReturnException} From a call, when the method returns `undefined` (whatever the schema), or a
 * value which does not match the schema (its cause is the `InvalidValueException` of the validation).
 * @example
 * ```typescript
 * import {Component, DTO} from 'lakutata'
 * import {Expect, Return} from 'lakutata/decorator/dto'
 *
 * class UserDTO extends DTO {
 *     @Expect(DTO.Number().integer().required())
 *     public id!: number
 *
 *     @Expect(DTO.String().required())
 *     public name!: string
 * }
 *
 * declare const db: {
 *     findUser(id: number): Promise<{id: number, name: string, passwordHash: string}>
 * }
 *
 * class Users extends Component {
 *     //The password hash is removed from the result: UserDTO has no schema for it
 *     @Return(UserDTO)
 *     public async find(id: number): Promise<{id: number, name: string}> {
 *         return await db.findUser(id)
 *     }
 * }
 * ```
 */
export function Return<ClassPrototype, DTOConstructor extends typeof DTO, Method>(def: DTOConstructor | Schema): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<any> => setMethodReturnValueValidator(target, propertyKey, descriptor, def)
}
