import {BaseObject} from '../../lib/base/BaseObject.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'

/**
 * Class Decorator
 * @constructor
 */
export function Injectable<ClassConstructor extends typeof BaseObject>(): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => {
        console.log('Injectable', target.name)
        return target
    }
}
