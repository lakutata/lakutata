import {DTO} from '../core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {BaseContext, ContextParams, ContextType} from '../base/Context.js'

export class HTTPContext extends BaseContext {

    @Expect(DTO.String().valid(ContextType.HTTP).default(ContextType.HTTP))
    public readonly type: ContextType

    @Expect(DTO.String().required())
    public readonly route: string

    @Expect(DTO.String().required())
    public readonly method: string

    @Expect(DTO.Object().default({}))
    public readonly data: Record<string, any>

    constructor(params: ContextParams<{
        readonly route: string
        readonly method: string
        readonly data: Record<string, any>
    }>) {
        super(params)
    }
}
