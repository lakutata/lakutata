/**
 * Derived from joi 18.0.2 lib/types/symbol.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Mechanical CommonJS to ESM conversion, to be rewritten in TypeScript
 */
import { assert } from '../../hoek/index.js';
import Any from './any.js';
const internals = {};


internals.Map = class extends Map {

    slice() {

        return new internals.Map(this);
    }
};


export default Any.extend({

    type: 'symbol',

    terms: {

        map: { init: new internals.Map() }
    },

    coerce: {
        method(value, { schema, error }) {

            const lookup = schema.$_terms.map.get(value);
            if (lookup) {
                value = lookup;
            }

            if (!schema._flags.only ||
                typeof value === 'symbol') {

                return { value };
            }

            return { value, errors: error('symbol.map', { map: schema.$_terms.map }) };
        }
    },

    validate(value, { error }) {

        if (typeof value !== 'symbol') {
            return { value, errors: error('symbol.base') };
        }
    },

    rules: {
        map: {
            method(iterable) {

                if (iterable &&
                    !iterable[Symbol.iterator] &&
                    typeof iterable === 'object') {

                    iterable = Object.entries(iterable);
                }

                assert(iterable && iterable[Symbol.iterator], 'Iterable must be an iterable or object');

                const obj = this.clone();

                const symbols = [];
                for (const entry of iterable) {
                    assert(entry && entry[Symbol.iterator], 'Entry must be an iterable');
                    const [key, value] = entry;

                    assert(typeof key !== 'object' && typeof key !== 'function' && typeof key !== 'symbol', 'Key must not be of type object, function, or Symbol');
                    assert(typeof value === 'symbol', 'Value must be a Symbol');

                    obj.$_terms.map.set(key, value);
                    symbols.push(value);
                }

                return obj.valid(...symbols);
            }
        }
    },

    manifest: {

        build(obj, desc) {

            if (desc.map) {
                obj = obj.map(desc.map);
            }

            return obj;
        }
    },

    messages: {
        'symbol.base': '{{#label}} must be a symbol',
        'symbol.map': '{{#label}} must be one of {{#map}}'
    }
});
