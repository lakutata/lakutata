import {BaseObject} from '../../lib/base/BaseObject.js'
import {ClassDecorator} from '../../types/ClassDecorator.js'
import {MarkObjectAsAutoload} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Class Decorator
 * @constructor
 */
export function Autoload<ClassConstructor extends typeof BaseObject>(): ClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => MarkObjectAsAutoload(target)
}
