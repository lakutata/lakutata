/**
 * Derived from the upstream lib/types/symbol.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../assert.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'
import type {SchemaTerms} from '../base.js'
import type {ValidationHelpers, ValidationOutcome} from '../model.js'

/**
 * A map of keys to symbols, sliced (copied) when the schema is cloned
 */
class SymbolMap extends Map<unknown, symbol> {
    public slice(): SymbolMap {
        return new SymbolMap(this)
    }
}

/**
 * The terms of symbol schemas
 */
export interface SymbolTerms {
    map: SymbolMap
}

/**
 * The symbol schema
 */
export interface SymbolSchema extends AnySchema {
    $_terms: SchemaTerms & AnyTerms & SymbolTerms
    map(iterable: Iterable<unknown> | Record<string, symbol>): this
}

const SymbolType: SymbolSchema = Any.extend<SymbolSchema>({

    type: 'symbol',

    terms: {

        map: {init: new SymbolMap()}
    },

    coerce: {
        method(value: unknown, {schema, error}: ValidationHelpers<SymbolSchema>): ValidationOutcome {
            const lookup: symbol | undefined = schema.$_terms.map.get(value)
            if (lookup) value = lookup
            if (!schema._flags.only ||
                typeof value === 'symbol') {
                return {value}
            }
            return {value, errors: error('symbol.map', {map: schema.$_terms.map})}
        }
    },

    validate(value: unknown, {error}: ValidationHelpers<SymbolSchema>): ValidationOutcome | undefined {
        if (typeof value !== 'symbol') return {value, errors: error('symbol.base')}
    },

    rules: {
        map: {
            method(this: SymbolSchema, iterable: unknown): SymbolSchema {
                if (iterable &&
                    !(iterable as Partial<Iterable<unknown>>)[Symbol.iterator] &&
                    typeof iterable === 'object') {
                    iterable = Object.entries(iterable)
                }
                assert(iterable && (iterable as Partial<Iterable<unknown>>)[Symbol.iterator], 'Iterable must be an iterable or object')
                const obj: SymbolSchema = this.clone()
                const symbols: symbol[] = []
                for (const entry of iterable as Iterable<unknown>) {
                    assert(entry && (entry as Partial<Iterable<unknown>>)[Symbol.iterator], 'Entry must be an iterable')
                    const [key, value] = entry as Iterable<unknown> as [unknown, unknown]
                    assert(typeof key !== 'object' && typeof key !== 'function' && typeof key !== 'symbol', 'Key must not be of type object, function, or Symbol')
                    assert(typeof value === 'symbol', 'Value must be a Symbol')
                    obj.$_terms.map.set(key, value)
                    symbols.push(value)
                }
                return obj.valid(...symbols)
            }
        }
    },

    manifest: {

        build(obj: SymbolSchema, desc: Record<string, unknown>): SymbolSchema {
            if (desc.map) obj = obj.map(desc.map as Iterable<unknown>)
            return obj
        }
    },

    messages: {
        'symbol.base': '{{#label}} must be a symbol',
        'symbol.map': '{{#label}} must be one of {{#map}}'
    }
})

export default SymbolType
