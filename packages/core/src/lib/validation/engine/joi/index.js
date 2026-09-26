/**
 * Derived from joi 18.0.2 lib/index.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Mechanical CommonJS to ESM conversion, to be rewritten in TypeScript
 */
import { assert, clone } from '../hoek/index.js';
import Cache from './cache.js';
import Common from './common.js';
import Compile from './compile.js';
import Errors from './errors.js';
import Extend from './extend.js';
import Manifest from './manifest.js';
import Ref from './ref.js';
import Template from './template.js';
import Trace from './trace.js';
import Lazy_types_alternatives from './types/alternatives.js';
import Lazy_types_any from './types/any.js';
import Lazy_types_array from './types/array.js';
import Lazy_types_boolean from './types/boolean.js';
import Lazy_types_date from './types/date.js';
import Lazy_types_function from './types/function.js';
import Lazy_types_link from './types/link.js';
import Lazy_types_number from './types/number.js';
import Lazy_types_object from './types/object.js';
import Lazy_types_string from './types/string.js';
import Lazy_types_symbol from './types/symbol.js';
import Lazy_types_binary from './types/binary.js';
import getSchemas from './schemas.js';
let Schemas;


const internals = {
    types: {
        alternatives: Lazy_types_alternatives,
        any: Lazy_types_any,
        array: Lazy_types_array,
        boolean: Lazy_types_boolean,
        date: Lazy_types_date,
        function: Lazy_types_function,
        link: Lazy_types_link,
        number: Lazy_types_number,
        object: Lazy_types_object,
        string: Lazy_types_string,
        symbol: Lazy_types_symbol
    },
    aliases: {
        alt: 'alternatives',
        bool: 'boolean',
        func: 'function'
    }
};


if (Buffer) {                                                           // $lab:coverage:ignore$
    internals.types.binary = Lazy_types_binary;
}


internals.root = function () {

    const root = {
        _types: new Set(Object.keys(internals.types))
    };

    // Types

    for (const type of root._types) {
        root[type] = function (...args) {

            assert(!args.length || ['alternatives', 'link', 'object'].includes(type), 'The', type, 'type does not allow arguments');
            return internals.generate(this, internals.types[type], args);
        };
    }

    // Shortcuts

    for (const method of ['allow', 'custom', 'disallow', 'equal', 'exist', 'forbidden', 'invalid', 'not', 'only', 'optional', 'options', 'prefs', 'preferences', 'required', 'strip', 'valid', 'when']) {
        root[method] = function (...args) {

            return this.any()[method](...args);
        };
    }

    // Methods

    Object.assign(root, internals.methods);

    // Aliases

    for (const alias in internals.aliases) {
        const target = internals.aliases[alias];
        root[alias] = root[target];
    }

    root.x = root.expression;

    // Trace

    if (Trace.setup) {                                          // $lab:coverage:ignore$
        Trace.setup(root);
    }

    return root;
};


internals.methods = {

    ValidationError: Errors.ValidationError,
    version: Common.version,
    cache: Cache.provider,

    assert(value, schema, ...args /* [message], [options] */) {

        internals.assert(value, schema, true, args);
    },

    attempt(value, schema, ...args /* [message], [options] */) {

        return internals.assert(value, schema, false, args);
    },

    build(desc) {

        assert(typeof Manifest.build === 'function', 'Manifest functionality disabled');
        return Manifest.build(this, desc);
    },

    checkPreferences(prefs) {

        Common.checkPreferences(prefs);
    },

    compile(schema, options) {

        return Compile.compile(this, schema, options);
    },

    defaults(modifier) {

        assert(typeof modifier === 'function', 'modifier must be a function');

        const joi = Object.assign({}, this);
        for (const type of joi._types) {
            const schema = modifier(joi[type]());
            assert(Common.isSchema(schema), 'modifier must return a valid schema object');

            joi[type] = function (...args) {

                return internals.generate(this, schema, args);
            };
        }

        return joi;
    },

    expression(...args) {

        return new Template(...args);
    },

    extend(...extensions) {

        Common.verifyFlat(extensions, 'extend');

        Schemas = Schemas || getSchemas();

        assert(extensions.length, 'You need to provide at least one extension');
        this.assert(extensions, Schemas.extensions);

        const joi = Object.assign({}, this);
        joi._types = new Set(joi._types);

        for (let extension of extensions) {
            if (typeof extension === 'function') {
                extension = extension(joi);
            }

            this.assert(extension, Schemas.extension);

            const expanded = internals.expandExtension(extension, joi);
            for (const item of expanded) {
                assert(joi[item.type] === undefined || joi._types.has(item.type), 'Cannot override name', item.type);

                const base = item.base || this.any();
                const schema = Extend.type(base, item);

                joi._types.add(item.type);
                joi[item.type] = function (...args) {

                    return internals.generate(this, schema, args);
                };
            }
        }

        return joi;
    },

    isError: Errors.ValidationError.isError,
    isExpression: Template.isTemplate,
    isRef: Ref.isRef,
    isSchema: Common.isSchema,

    in(...args) {

        return Ref.in(...args);
    },

    override: Common.symbols.override,

    ref(...args) {

        return Ref.create(...args);
    },

    types() {

        const types = {};
        for (const type of this._types) {
            types[type] = this[type]();
        }

        for (const target in internals.aliases) {
            types[target] = this[target]();
        }

        return types;
    }
};


// Helpers

internals.assert = function (value, schema, annotate, args /* [message], [options] */) {

    const message = args[0] instanceof Error || typeof args[0] === 'string' ? args[0] : null;
    const options = message !== null ? args[1] : args[0];
    const result = schema.validate(value, Common.preferences({ errors: { stack: true } }, options || {}));

    let error = result.error;
    if (!error) {
        return result.value;
    }

    if (message instanceof Error) {
        throw message;
    }

    const display = annotate && typeof error.annotate === 'function' ? error.annotate() : error.message;

    if (error instanceof Errors.ValidationError === false) {
        error = clone(error);
    }

    error.message = message ? `${message} ${display}` : display;
    throw error;
};


internals.generate = function (root, schema, args) {

    assert(root, 'Must be invoked on a Joi instance.');

    schema.$_root = root;

    if (!schema._definition.args ||
        !args.length) {

        return schema;
    }

    return schema._definition.args(schema, ...args);
};


internals.expandExtension = function (extension, joi) {

    if (typeof extension.type === 'string') {
        return [extension];
    }

    const extended = [];
    for (const type of joi._types) {
        if (extension.type.test(type)) {
            const item = Object.assign({}, extension);
            item.type = type;
            item.base = joi[type]();
            extended.push(item);
        }
    }

    return extended;
};


export default internals.root();
