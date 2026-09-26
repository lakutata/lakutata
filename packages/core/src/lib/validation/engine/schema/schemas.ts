/**
 * Derived from the upstream lib/schemas.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import type {Base} from './base.js'
import Engine from './index.js'
import {Lazy, type LazySchemas} from './lazy.js'
import type {ObjectSchema} from './types/object.js'
import type {StringSchema} from './types/string.js'

const schemas: LazySchemas = {} as LazySchemas
let built: boolean = false

/**
 * The schemas are built on first use: building them needs the fully loaded root (index.js), which imports this
 * module (CommonJS upstream required it lazily for the same reason)
 */
export default function getSchemas(): LazySchemas {
    if (!built) {
        built = true
        build()
    }
    return schemas
}

function build(): void {
    //Preferences
    const wrap: StringSchema = Engine.string()
        .min(1)
        .max(2)
        .allow(false)
    schemas.preferences = Engine.object({
        allowUnknown: Engine.boolean(),
        abortEarly: Engine.boolean(),
        artifacts: Engine.boolean(),
        cache: Engine.boolean(),
        context: Engine.object(),
        convert: Engine.boolean(),
        dateFormat: Engine.valid('date', 'iso', 'string', 'time', 'utc'),
        debug: Engine.boolean(),
        errors: {
            escapeHtml: Engine.boolean(),
            label: Engine.valid('path', 'key', false),
            language: [
                Engine.string(),
                Engine.object().ref()
            ],
            render: Engine.boolean(),
            stack: Engine.boolean(),
            wrap: {
                label: wrap,
                array: wrap,
                string: wrap
            }
        },
        externals: Engine.boolean(),
        messages: Engine.object(),
        noDefaults: Engine.boolean(),
        nonEnumerables: Engine.boolean(),
        presence: Engine.valid('required', 'optional', 'forbidden'),
        skipFunctions: Engine.boolean(),
        stripUnknown: Engine.object({
            arrays: Engine.boolean(),
            objects: Engine.boolean()
        })
            .or('arrays', 'objects')
            .allow(true, false),
        warnings: Engine.boolean()
    })
        .strict()
    //Extensions
    const nameRx: RegExp = /^[a-zA-Z0-9]\w*$/
    const rule: ObjectSchema = Engine.object({
        alias: Engine.array().items(Engine.string().pattern(nameRx)).single(),
        args: Engine.array().items(
            Engine.string(),
            Engine.object({
                name: Engine.string().pattern(nameRx).required(),
                ref: Engine.boolean(),
                assert: Engine.alternatives([
                    Engine.function(),
                    Engine.object().schema()
                ])
                    .conditional('ref', { is: true, then: Engine.required() }),
                normalize: Engine.function(),
                message: Engine.string().when('assert', { is: Engine.function(), then: Engine.required() })
            })
        ),
        convert: Engine.boolean(),
        manifest: Engine.boolean(),
        method: Engine.function().allow(false),
        multi: Engine.boolean(),
        validate: Engine.function()
    })
    schemas.extension = Engine.object({
        type: Engine.alternatives([
            Engine.string(),
            Engine.object().regex()
        ])
            .required(),
        args: Engine.function(),
        cast: Engine.object().pattern(nameRx, Engine.object({
            from: Engine.function().maxArity(1).required(),
            to: Engine.function().minArity(1).maxArity(2).required()
        })),
        base: Engine.object().schema()
            .when('type', { is: Engine.object().regex(), then: Engine.forbidden() }),
        coerce: [
            Engine.function().maxArity(3),
            Engine.object({ method: Engine.function().maxArity(3).required(), from: Engine.array().items(Engine.string()).single() })
        ],
        flags: Engine.object().pattern(nameRx, Engine.object({
            setter: Engine.string(),
            default: Engine.any()
        })),
        manifest: {
            build: Engine.function().arity(2)
        },
        messages: [Engine.object(), Engine.string()],
        modifiers: Engine.object().pattern(nameRx, Engine.function().minArity(1).maxArity(2)),
        overrides: Engine.object().pattern(nameRx, Engine.function()),
        prepare: Engine.function().maxArity(3),
        rebuild: Engine.function().arity(1),
        rules: Engine.object().pattern(nameRx, rule),
        terms: Engine.object().pattern(nameRx, Engine.object({
            init: Engine.array().allow(null).required(),
            manifest: Engine.object().pattern(/.+/, [
                Engine.valid('schema', 'single'),
                Engine.object({
                    mapped: Engine.object({
                        from: Engine.string().required(),
                        to: Engine.string().required()
                    })
                        .required()
                })
            ])
        })),
        validate: Engine.function().maxArity(3)
    })
        .strict()
    schemas.extensions = Engine.array().items(Engine.object(), Engine.function().arity(1)).strict()
    //Manifest
    const desc: Record<string, Base> = {
        buffer: Engine.object({
            buffer: Engine.string()
        }),
        func: Engine.object({
            function: Engine.function().required(),
            options: {
                literal: true
            }
        }),
        override: Engine.object({
            override: true
        }),
        ref: Engine.object({
            ref: Engine.object({
                type: Engine.valid('value', 'global', 'local'),
                path: Engine.array().required(),
                separator: Engine.string().length(1).allow(false),
                ancestor: Engine.number().min(0).integer().allow('root'),
                map: Engine.array().items(Engine.array().length(2)).min(1),
                adjust: Engine.function(),
                iterables: Engine.boolean(),
                in: Engine.boolean(),
                render: Engine.boolean()
            })
                .required()
        }),
        regex: Engine.object({
            regex: Engine.string().min(3)
        }),
        special: Engine.object({
            special: Engine.valid('deep').required()
        }),
        template: Engine.object({
            template: Engine.string().required(),
            options: Engine.object()
        }),
        value: Engine.object({
            value: Engine.alternatives([Engine.object(), Engine.array()]).required()
        })
    }
    desc.entity = Engine.alternatives([
        Engine.array().items(Engine.link('...')),
        Engine.boolean(),
        Engine.function(),
        Engine.number(),
        Engine.string(),
        desc.buffer,
        desc.func,
        desc.ref,
        desc.regex,
        desc.special,
        desc.template,
        desc.value,
        Engine.link('/')
    ])
    desc.values = Engine.array()
        .items(
            null,
            Engine.boolean(),
            Engine.function(),
            Engine.number().allow(Infinity, -Infinity),
            Engine.string().allow(''),
            Engine.symbol(),
            desc.buffer,
            desc.func,
            desc.override,
            desc.ref,
            desc.regex,
            desc.template,
            desc.value
        )
    desc.messages = Engine.object()
        .pattern(/.+/, [
            Engine.string(),
            desc.template,
            Engine.object().pattern(/.+/, [Engine.string(), desc.template])
        ])
    schemas.description = Engine.object({
        type: Engine.string().required(),
        flags: Engine.object({
            cast: Engine.string(),
            default: Engine.any(),
            description: Engine.string(),
            empty: Engine.link('/'),
            failover: desc.entity,
            id: Engine.string(),
            label: Engine.string(),
            only: true,
            presence: ['optional', 'required', 'forbidden'],
            result: ['raw', 'strip'],
            strip: Engine.boolean(),
            unit: Engine.string()
        })
            .unknown(),
        preferences: {
            allowUnknown: Engine.boolean(),
            abortEarly: Engine.boolean(),
            artifacts: Engine.boolean(),
            cache: Engine.boolean(),
            convert: Engine.boolean(),
            dateFormat: ['date', 'iso', 'string', 'time', 'utc'],
            errors: {
                escapeHtml: Engine.boolean(),
                label: ['path', 'key'],
                language: [
                    Engine.string(),
                    desc.ref
                ],
                wrap: {
                    label: wrap,
                    array: wrap
                }
            },
            externals: Engine.boolean(),
            messages: desc.messages,
            noDefaults: Engine.boolean(),
            nonEnumerables: Engine.boolean(),
            presence: ['required', 'optional', 'forbidden'],
            skipFunctions: Engine.boolean(),
            stripUnknown: Engine.object({
                arrays: Engine.boolean(),
                objects: Engine.boolean()
            })
                .or('arrays', 'objects')
                .allow(true, false),
            warnings: Engine.boolean()
        },
        allow: desc.values,
        invalid: desc.values,
        rules: Engine.array().min(1).items({
            name: Engine.string().required(),
            args: Engine.object().min(1),
            keep: Engine.boolean(),
            message: [
                Engine.string(),
                desc.messages
            ],
            warn: Engine.boolean()
        }),
        //Terms
        keys: Engine.object().pattern(/.*/, Engine.link('/')),
        link: desc.ref
    })
        .pattern(/^[a-z]\w*$/, Engine.any())
}

Lazy.schemas = getSchemas
