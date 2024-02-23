import {DTO} from '../../lib/core/DTO.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'

/**
 * Class Decorator
 * @constructor
 */
export function IndexSignature<ClassConstructor extends typeof DTO>(): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => {
        //TODO
        return target
    }
}
