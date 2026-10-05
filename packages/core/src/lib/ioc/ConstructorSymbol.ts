import {DI_TARGET_CONSTRUCTOR_SYMBOL} from '../../constants/DIMetadataKey.js'
import {randomUUID} from 'node:crypto'
import {IConstructor} from '../../interfaces/IConstructor.js'

const symbolConstructorMap: Map<symbol, string> = new Map()

export function constructorSymbol<T>(constructor: IConstructor<T>): symbol {
    if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, constructor)) {
        const uuidSymbol: symbol = Symbol(randomUUID())
        symbolConstructorMap.set(uuidSymbol, constructor.name)
        Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, uuidSymbol, constructor)
    }
    return Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_SYMBOL, constructor)
}

export function resolveConstructorNameBySymbol(symbol: symbol): string | symbol {
    const realName: string | undefined = symbolConstructorMap.get(symbol)
    if (realName) return realName
    return symbol
}
