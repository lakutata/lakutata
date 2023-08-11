import {DTO} from '../lib/base/DTO.js'
import {Expect} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export class LoadEntryCommonOptions extends DTO {

    /**
     * 需要传入的参数
     */
    @Expect(Validator.Object().pattern(Validator.String(), Validator.Any()).optional().default({}))
    public declare readonly config?: Record<string, any>

}
