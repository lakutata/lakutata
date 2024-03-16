import {BaseContext, ContextType} from '../base/Context.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {DTO} from '../core/DTO.js'

export class CLIContext extends BaseContext {
    @Expect(DTO.String().valid(ContextType.CLI).default(ContextType.CLI))
    public readonly type: ContextType
}