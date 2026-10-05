import {DTO} from '../../lib/dto/DTO.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {setMethodAcceptArgumentsValidator} from '../../lib/dto/MethodValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Validate the arguments of each call of the method, in order, against the schemas given; the method then receives the
 * validated values (defaults applied, the keys without schema removed). A DTO class validates its argument against its
 * schema: the method receives a plain object, not an instance of the class. The arguments beyond the schemas given are
 * passed unchecked. An async method is validated asynchronously (its call rejects on failure), another method
 * synchronously.
 * @remarks A missing argument is accepted unless its schema is required (`MyDTO.required()`,
 * `DTO.String().required()`), whether it is omitted or passed as `undefined` (its default then applied).
 * @param defs The schemas of the arguments, by position: DTO classes or schemas (`DTO.String()`).
 * @returns The method decorator; the decorated method cannot be reassigned.
 * @throws {InvalidMethodAcceptException} From a call, when an argument does not match its schema (its cause is the
 * `InvalidValueException` of the validation).
 * @example
 * ```typescript
 * import {Component, DTO} from 'lakutata'
 * import {Accept, Expect} from 'lakutata/decorator/dto'
 *
 * class TransferDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public to!: string
 *
 *     @Expect(DTO.Number().positive().required())
 *     public amount!: number
 * }
 *
 * class Bank extends Component {
 *     //The transfer is required, the note optional
 *     @Accept(TransferDTO.required(), DTO.String().max(140).optional())
 *     public async transfer(transfer: TransferDTO, note?: string): Promise<void> {
 *         console.log(`${transfer.amount} to ${transfer.to}`, note)
 *     }
 * }
 * ```
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO, Method>(...defs: (DTOConstructor | Schema)[]): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<any> => setMethodAcceptArgumentsValidator(target, propertyKey, descriptor, defs)
}
