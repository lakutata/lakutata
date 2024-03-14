import {DTO} from '../core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'

/**
 * Context types
 */
export enum ContextType {
    CLI = 'CLI',
    HTTP = 'HTTP',
    SERVICE = 'SERVICE'
}

/**
 * Base context class
 */
export class BaseContext extends DTO {
    @Expect(DTO.String().valid(ContextType.CLI, ContextType.HTTP, ContextType.SERVICE))
    public readonly type: ContextType
}
