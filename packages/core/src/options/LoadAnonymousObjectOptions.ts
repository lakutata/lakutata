import {DTO} from '../lib/dto/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

/**
 * The declaration of an anonymous object in the `objects.anonymous` module option: its class and its options. The
 * object is registered by its class (got with `getObject(TheClass)` or `@Inject(TheClass)`), with its options; the
 * keys other than `class` are its options (the values of its `@Configurable` properties).
 * @example
 * ```typescript
 * import {Application, BaseObject, DTO, type LoadAnonymousObjectOptions} from 'lakutata'
 * import {Configurable} from 'lakutata/decorator/di'
 *
 * class Mailer extends BaseObject {
 *     @Configurable(DTO.String())
 *     protected readonly host: string = 'localhost'
 * }
 *
 * const mailer: LoadAnonymousObjectOptions = {class: Mailer, host: 'smtp.example.com'}
 *
 * Application.run({
 *     id: 'mail.app',
 *     name: 'Mail',
 *     objects: {
 *         anonymous: [mailer]
 *     }
 * })
 * ```
 */
@IndexSignature(DTO.Any())
export class LoadAnonymousObjectOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {

    /**
     * The class of the object, a {@link BaseObject} subclass. Required.
     */
    @Expect(DTO.Class(() => BaseObject).required())
    public class: ClassConstructor

}
