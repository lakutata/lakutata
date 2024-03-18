import {AnySchema} from './AnySchema.js'

export interface SymbolSchema<TSchema = Symbol> extends AnySchema<TSchema> {
    map(iterable: Iterable<[string | number | boolean | symbol, symbol]> | { [key: string]: symbol }): this
}
