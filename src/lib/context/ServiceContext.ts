import {DTO} from '../core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {BaseContext, type ContextParams, ContextType} from '../base/Context.js'
import {type ActionPattern } from '../../types/ActionPattern.js'

export class ServiceContext<T extends Record<string, any> = {}> extends BaseContext {

    @Expect(DTO.String().valid(ContextType.SERVICE).default(ContextType.SERVICE))
    public readonly type: ContextType

    @Expect(DTO.Object().pattern(DTO.String(), DTO.Any()).required())
    public input: ActionPattern<T>

    constructor(params: ContextParams<{
        readonly input: ActionPattern
        readonly data: Record<string, any>
    }>) {
        super(params)
    }
}
