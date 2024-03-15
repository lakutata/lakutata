import {DTO} from '../core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {BaseContext, ContextType} from '../base/Context.js'

export class HTTPContext extends BaseContext {

    @Expect(DTO.String().valid(ContextType.HTTP).default(ContextType.HTTP))
    public readonly type: ContextType

    @Expect(DTO.String().required())
    public readonly route: string

    @Expect(DTO.String().required())
    public readonly method: string

    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    public readonly query: Record<string, string>

    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    public readonly params: Record<string, string>

    @Expect(DTO.Any())
    public readonly body: any


}
