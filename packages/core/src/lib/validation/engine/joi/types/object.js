/**
 * Derived from joi 18.0.2 lib/types/object.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Mechanical CommonJS to ESM conversion, to be rewritten in TypeScript
 */
import Keys from './keys.js';
const internals = {};


export default Keys.extend({

    type: 'object',

    cast: {
        map: {
            from: (value) => value && typeof value === 'object',
            to(value, helpers) {

                return new Map(Object.entries(value));
            }
        }
    }
});
