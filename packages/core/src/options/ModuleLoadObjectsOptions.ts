import {DTO} from '../lib/dto/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {LoadNamedObjectOptions} from './LoadNamedObjectOptions.js'
import {LoadAnonymousObjectOptions} from './LoadAnonymousObjectOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'

export type AnonymousObject =
    LoadAnonymousObjectOptions
    | typeof BaseObject
    | string

/**
 * The `objects` module option: the objects a module declares besides its components and providers (plain objects,
 * modules), named or anonymous.
 * @example
 * ```typescript
 * import {Application, BaseObject, type ModuleLoadObjectsOptions, Module} from 'lakutata'
 *
 * class Cart extends BaseObject {
 * }
 *
 * class Catalog extends Module {
 * }
 *
 * const objects: ModuleLoadObjectsOptions = {
 *     named: {
 *         catalog: {class: Catalog}
 *     },
 *     anonymous: [Cart, './dist/objects/*.js']
 * }
 *
 * Application.run({id: 'shop.app', name: 'Shop', objects: objects})
 * ```
 */
export class ModuleLoadObjectsOptions extends DTO {

    /**
     * The objects registered under a name (got with `getObject('name')` or `@Inject('name')`): their declarations
     * (`{class, ...options}`), by name.
     * @default {}
     */
    @Expect(LoadNamedObjectOptions.optional().default({}))
    public named?: LoadNamedObjectOptions

    /**
     * The objects registered by their class (got with `getObject(TheClass)` or `@Inject(TheClass)`): classes,
     * declarations (`{class, ...options}`), or glob patterns of the files to import, relative to the working
     * directory, each file registering its first export when it is a {@link BaseObject} subclass.
     * @default []
     */
    @Expect(
        DTO.Array(
            DTO.Alternatives(
                LoadAnonymousObjectOptions.Schema(),
                DTO.Class(BaseObject),
                DTO.Glob()
            )
        )
            .optional()
            .default([])
    )
    public anonymous?: AnonymousObject[]
}
