import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_CONSTRUCTOR_SYMBOL} from '../../../constants/DIMetadataKey.js'
import {randomUUID} from 'node:crypto'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'

const symbolConstructorMap: Map<symbol, string> = new Map()

export function ConstructorSymbol<T extends BaseObject>(constructor: IBaseObjectConstructor<T>): symbol {
    if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, constructor)) {
        const uuidSymbol: symbol = Symbol(randomUUID())
        symbolConstructorMap.set(uuidSymbol, constructor.name)
        Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, uuidSymbol, constructor)
    }
    return Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, constructor)
}

export function ResolveConstructorNameBySymbol(symbol: symbol): string | symbol {
    const realName: string | undefined = symbolConstructorMap.get(symbol)
    if (realName) return realName
    return symbol
}
