import {DTO, type ActionPattern} from '@lakutata/core'
import {Expect, IndexSignature} from '@lakutata/core/decorator/dto'

/**
 * Context types
 */
export enum ContextType {
    CLI = 'CLI',
    HTTP = 'HTTP',
    SERVICE = 'SERVICE',
    SCHEDULE = 'SCHEDULE'
}

export type ContextParams<T extends {} = {}> = T & Record<string, any>

/**
 * Base context class
 */
@IndexSignature(DTO.Any())
export class BaseContext<T extends Record<string, any> = {}> extends DTO {
    //The type of the context: one of ContextType for the built-in channels, the context type of their channel for the others
    @Expect(DTO.String().required())
    public readonly type: ContextType | string

    @Expect(DTO.Object().pattern(DTO.String(), DTO.Any()).required())
    public data: ActionPattern<T>

    //The language of the request (given by the i18n middleware): the errors of the validation of its input are in it
    @Expect(DTO.String().optional())
    public locale?: string

    constructor(params: ContextParams) {
        super(params)
    }
}
