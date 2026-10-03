import {DTO, type ActionPattern} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {type ServiceContextParams} from '../types/ServiceContextParams.js'

export class ServiceContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    @Expect(DTO.String().valid(ContextType.SERVICE).default(ContextType.SERVICE))
    public readonly type: ContextType

    @Expect(DTO.Object().pattern(DTO.String(), DTO.Any()).required())
    public input: ActionPattern<T>

    /**
     * The client of the request (the renderer of a window, a socket): the events are pushed to it by its id
     * (Entrypoint.notify), undefined for the transports without clients
     */
    @Expect(DTO.String().optional())
    public readonly clientId?: string

    constructor(params: ContextParams<ServiceContextParams>) {
        params = {...params, input: {...params.data}}
        super(params)
    }
}
