import {AnySchema} from './AnySchema.js'

/**
 * A schema of symbols, built by `DTO.Symbol()`.
 * @typeParam TSchema The type of the symbols the schema validates.
 */
export interface SymbolSchema<TSchema = Symbol> extends AnySchema<TSchema> {
    /**
     * Map values to symbols: with conversion enabled (`strict(false)`), a key of the map is converted to its symbol.
     * The symbols of the map become the only valid values.
     * @param iterable The symbols by key: an object, or an iterable of `[key, symbol]` pairs (a `Map`).
     * @returns A new schema.
     */
    map(iterable: Iterable<[string | number | boolean | symbol, symbol]> | { [key: string]: symbol }): this
}
