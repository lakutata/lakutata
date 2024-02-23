import {BaseObject} from '../BaseObject.js'
import {IConstructor} from '../../../interfaces/IConstructor.js'
import {DI_TARGET_CONSTRUCTOR_SYMBOL} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {randomUUID} from 'node:crypto'

export function ConstructorSymbol<T extends BaseObject>(constructor: IConstructor<T>): symbol {
    if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, constructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, Symbol(randomUUID()), constructor)
    return Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, constructor)
}
