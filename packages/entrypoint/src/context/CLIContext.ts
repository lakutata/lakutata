import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {Expect} from '@lakutata/core/decorator/dto'
import {DTO} from '@lakutata/core'

export class CLIContext<T extends Record<string, any> = {}> extends BaseContext<T> {
    @Expect(DTO.String().valid(ContextType.CLI).default(ContextType.CLI))
    public readonly type: ContextType

    @Expect(DTO.String().required())
    public command: string

    constructor(params: ContextParams<{
        readonly command: string
        readonly data: Record<string, any>
    }>) {
        super(params)
    }
}
