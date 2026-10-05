import {Container} from '../../core/Container.js'
import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_CONTAINER} from '../../../constants/DIMetadataKey.js'

/**
 * Set container getter
 * @param target
 * @param container
 * @constructor
 */
export function setObjectContainerGetter<ClassPrototype extends BaseObject>(target: ClassPrototype, container: Container): void {
    Reflect.defineMetadata(DI_TARGET_CONTAINER, () => container, target)
}

/**
 * Get container via class prototype
 * @param target
 * @constructor
 */
export function getObjectContainer<ClassPrototype extends BaseObject>(target: ClassPrototype): Container {
    const containerGetter: () => Container = Reflect.getOwnMetadata(DI_TARGET_CONTAINER, target)
    return containerGetter()
}
