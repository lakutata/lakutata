import {DTO} from './DTO.js'
import {IndexSignature} from '../../decorators/dto/IndexSignature.js'

/**
 * A DTO accepting any key: the keys without an `@Expect` schema are kept, whatever their values (`@IndexSignature` with
 * `DTO.Any()`), instead of removed. Extend it for the data whose keys are not all known, while validating the known ones.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {FlexibleDTO} from 'lakutata/dtos'
 *
 * //An event: its type is validated, its other fields are kept as they are
 * class EventDTO extends FlexibleDTO {
 *     @Expect(DTO.String().required())
 *     public type!: string
 * }
 *
 * const event: EventDTO = new EventDTO({type: 'login', user: 'ada', at: Date.now()})
 * console.log(event.user)
 * ```
 */
@IndexSignature(DTO.Any())
export class FlexibleDTO extends DTO {
    [prop: string]: any
}
