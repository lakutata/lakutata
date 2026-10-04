import {DTO} from '../lib/dto/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

/**
 * The declaration of a component or a provider in the module options: its class and its options (the keys other than
 * `class`, the values of its `@Configurable` properties). Without class, it completes the options of the object of the
 * same name declared by the module's initializer or by `Application.preset()`: its options override theirs.
 * @example
 * ```typescript
 * import {Component, DTO, Module, type ModuleOptions, type OverridableObjectOptions} from 'lakutata'
 * import {Configurable} from 'lakutata/decorator/di'
 *
 * class Cache extends Component {
 *     @Configurable(DTO.Number().integer().min(0))
 *     protected readonly ttl: number = 60
 * }
 *
 * const declaration: OverridableObjectOptions<typeof Cache> = {class: Cache, ttl: 300}
 *
 * export class CacheModule extends Module {
 *     protected options: ModuleOptions = {
 *         components: {cache: declaration}
 *     }
 * }
 *
 * //The cache of this module keeps its entries 10 seconds: its ttl overrides the declared one
 * export const override: OverridableObjectOptions<typeof Cache> = {ttl: 10}
 * ```
 */
@IndexSignature(DTO.Any())
export class OverridableObjectOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {

    /**
     * The class of the object; omitted to complete the declaration of the same name.
     */
    @Expect(DTO.Class(() => BaseObject).optional())
    public class?: ClassConstructor

}
