import {DTO} from '../lib/dto/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

export const OBJECT_ID = Symbol('OBJECT_ID')

/**
 * The declaration of an object given to `Container.load()` and in the `objects.named` module option: its class and its
 * options (the keys other than `class`, the values of its `@Configurable` properties).
 * @example
 * ```typescript
 * import {BaseObject, Container, DTO, type LoadObjectOptions} from 'lakutata'
 * import {Configurable} from 'lakutata/decorator/di'
 *
 * class Mailer extends BaseObject {
 *     @Configurable(DTO.String())
 *     protected readonly host: string = 'localhost'
 * }
 *
 * const declaration: LoadObjectOptions = {class: Mailer, host: 'smtp.example.com'}
 *
 * const container: Container = new Container()
 * await container.load([declaration])
 * const mailer: Mailer = await container.get(Mailer)
 * ```
 */
@IndexSignature(DTO.Any())
export class LoadObjectOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {

    @Expect(DTO.Alternatives(DTO.String(), DTO.Symbol()).optional())
    public [OBJECT_ID]?: string | symbol

    /**
     * The class of the object, a {@link BaseObject} subclass. Required.
     */
    @Expect(DTO.Class(() => BaseObject).required())
    public class: ClassConstructor

}
