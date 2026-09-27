import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {IncomingMessage, ServerResponse} from 'node:http'

export class HTTPContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    @Expect(DTO.String().valid(ContextType.HTTP).default(ContextType.HTTP))
    public readonly type: ContextType

    @Expect(DTO.String().required())
    public readonly route: string

    @Expect(DTO.String().required())
    public readonly method: string

    @Expect(DTO.InstanceOf(IncomingMessage))
    public readonly request: IncomingMessage

    @Expect(DTO.InstanceOf(ServerResponse))
    public readonly response: ServerResponse

    constructor(params: ContextParams<{
        readonly route: string
        readonly method: string
        readonly request: IncomingMessage
        readonly response: ServerResponse
        readonly data: Record<string, any>
    }>) {
        super(params)
    }
}
