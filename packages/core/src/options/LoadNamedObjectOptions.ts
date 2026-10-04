import {DTO} from '../lib/dto/DTO.js'
import {LoadObjectOptions} from './LoadObjectOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

/**
 * The named objects of the `objects.named` module option: each declaration (its class and its options, see
 * {@link LoadObjectOptions}) under the name the object is registered under (got with `getObject('name')` or
 * `@Inject('name')`). A module is declared here.
 * @example
 * ```typescript
 * import {Application, BaseObject, type LoadNamedObjectOptions} from 'lakutata'
 *
 * class Cart extends BaseObject {
 * }
 *
 * const named: LoadNamedObjectOptions = {
 *     cart: {class: Cart}
 * }
 *
 * Application.run({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     objects: {
 *         named: named
 *     }
 * })
 * ```
 */
@IndexSignature(LoadObjectOptions.Schema())
export class LoadNamedObjectOptions extends DTO {
    [id: string]: LoadObjectOptions
}
