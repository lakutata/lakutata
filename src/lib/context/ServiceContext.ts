import {DTO} from '../core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import * as ActionPatternJs from '../../types/ActionPattern.js'
import {BaseContext, ContextType} from '../base/Context.js'

export class ServiceContext<T extends Record<string, any> = {}> extends BaseContext {

    @Expect(DTO.String().valid(ContextType.SERVICE).default(ContextType.SERVICE))
    public readonly type: ContextType

    @Expect(DTO.Object().pattern(DTO.String(), DTO.Any()).required())
    public input: ActionPatternJs.ActionPattern<T>

}
