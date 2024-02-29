import {BaseObject} from '../../lib/base/BaseObject.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'
import {MarkObjectAsAutoload} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Class Decorator
 * @constructor
 */
export function Autoload<ClassConstructor extends typeof BaseObject>(): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => MarkObjectAsAutoload(target)
}
