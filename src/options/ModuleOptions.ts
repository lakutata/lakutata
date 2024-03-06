import {DTO} from '../lib/core/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'

type BootstrapOption<ObjectConstructor extends typeof BaseObject> = string | symbol | ObjectConstructor

export class ModuleOptions<ObjectConstructor extends typeof BaseObject> extends DTO {

    /**
     * Bootstrap option
     */
    @Expect(
        DTO.Array(
            DTO.Alternatives(
                DTO.String(),
                DTO.Class(BaseObject),
                DTO.AsyncFunction()
            )
        )
            .optional()
            .default([])
    )
    public bootstrap?: BootstrapOption<ObjectConstructor>[]
}
