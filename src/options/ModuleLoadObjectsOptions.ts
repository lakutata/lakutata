import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {LoadNamedObjectOptions} from './LoadNamedObjectOptions.js'
import {LoadAnonymousObjectOptions} from './LoadAnonymousObjectOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'

type AnonymousObject =
    LoadAnonymousObjectOptions
    | typeof BaseObject
    | string

export class ModuleLoadObjectsOptions extends DTO {

    @Expect(LoadNamedObjectOptions.optional().default({}))
    public named?: LoadNamedObjectOptions

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
