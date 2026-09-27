import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {IndexSignature} from '@lakutata/core/decorator/dto'
import type {ActionPattern} from '@lakutata/core'

/**
 * Context types
 */
export enum ContextType {
    CLI = 'CLI',
    HTTP = 'HTTP',
    SERVICE = 'SERVICE'
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

    constructor(params: ContextParams) {
        super(params)
    }
}
