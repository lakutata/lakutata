import {DTO} from '../lib/dto/DTO.js'
import {OverridableObjectOptions} from './OverridableObjectOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {IBaseObjectConstructor} from '../interfaces/IBaseObjectConstructor.js'

/**
 * The `components` and `providers` module options: each declaration (see {@link OverridableObjectOptions}) under the
 * name the object is registered under (got with `getObject('name')` or `@Inject('name')`).
 * @example
 * ```typescript
 * import {Application, Component, type IBaseObjectConstructor, type OverridableNamedObjectOptions} from 'lakutata'
 *
 * class Mailer extends Component {
 * }
 *
 * const components: OverridableNamedObjectOptions<IBaseObjectConstructor<Component>> = {
 *     mailer: {class: Mailer},
 *     //Completes the options of the "log" component preset by the lakutata package
 *     log: {level: 'debug'}
 * }
 *
 * Application.run({id: 'mail.app', name: 'Mail', components: components})
 * ```
 */
@IndexSignature(OverridableObjectOptions.Schema())
export class OverridableNamedObjectOptions<ClassConstructor extends IBaseObjectConstructor<BaseObject> = IBaseObjectConstructor<BaseObject>> extends DTO {
    [id: string]: OverridableObjectOptions<ClassConstructor>
}
