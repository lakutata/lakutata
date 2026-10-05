import {objectParentConstructors} from '@lakutata/utils/ObjectParentConstructors'

/**
 * The declaration of a property removed by a class: a subclass declaring the property otherwise (an injection
 * declared again as a configurable property, or a configurable property declared again as an injection)
 */
export const REMOVED: unique symbol = Symbol('REMOVED')

/**
 * The declarations of the properties of a class only, and the declarations of its parents it removes
 */
type OwnDeclarations<Declaration> = Map<string | symbol, Declaration | typeof REMOVED>

/**
 * The declarations of the properties of a class only (created when missing)
 * @param metadataKey
 * @param target
 */
export function OwnDeclarations<Declaration>(metadataKey: string | symbol, target: Function): OwnDeclarations<Declaration> {
    let declarations: OwnDeclarations<Declaration> | undefined = Reflect.getOwnMetadata(metadataKey, target)
    if (!declarations) {
        declarations = new Map()
        Reflect.defineMetadata(metadataKey, declarations, target)
    }
    return declarations
}

/**
 * The declarations of the properties of a class and of its parents: from the farthest parent to the class, the closest
 * declaration of a property wins, a removal by a closer class removes it
 * @param metadataKey
 * @param target
 */
export function MergedDeclarations<Declaration>(metadataKey: string | symbol, target: Function): Map<string | symbol, Declaration> {
    const merged: Map<string | symbol, Declaration> = new Map()
    for (const constructor of [...objectParentConstructors(target).reverse(), target]) {
        const own: OwnDeclarations<Declaration> | undefined = Reflect.getOwnMetadata(metadataKey, constructor)
        own?.forEach((declaration: Declaration | typeof REMOVED, propertyKey: string | symbol): void => {
            if (declaration === REMOVED) {
                merged.delete(propertyKey)
            } else {
                merged.set(propertyKey, declaration)
            }
        })
    }
    return merged
}
