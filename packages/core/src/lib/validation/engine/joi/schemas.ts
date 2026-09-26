/**
 * Derived from joi 18.0.2 lib/schemas.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import type {Base} from './base.js'
import Joi from './index.js'
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
    const wrap: StringSchema = Joi.string()
        .min(1)
        .max(2)
        .allow(false)
    schemas.preferences = Joi.object({
        allowUnknown: Joi.boolean(),
        abortEarly: Joi.boolean(),
        artifacts: Joi.boolean(),
        cache: Joi.boolean(),
        context: Joi.object(),
        convert: Joi.boolean(),
        dateFormat: Joi.valid('date', 'iso', 'string', 'time', 'utc'),
        debug: Joi.boolean(),
        errors: {
            escapeHtml: Joi.boolean(),
            label: Joi.valid('path', 'key', false),
            language: [
                Joi.string(),
                Joi.object().ref()
            ],
            render: Joi.boolean(),
            stack: Joi.boolean(),
            wrap: {
                label: wrap,
                array: wrap,
                string: wrap
            }
        },
        externals: Joi.boolean(),
        messages: Joi.object(),
        noDefaults: Joi.boolean(),
        nonEnumerables: Joi.boolean(),
        presence: Joi.valid('required', 'optional', 'forbidden'),
        skipFunctions: Joi.boolean(),
        stripUnknown: Joi.object({
            arrays: Joi.boolean(),
            objects: Joi.boolean()
        })
            .or('arrays', 'objects')
            .allow(true, false),
        warnings: Joi.boolean()
    })
        .strict()
    //Extensions
    const nameRx: RegExp = /^[a-zA-Z0-9]\w*$/
    const rule: ObjectSchema = Joi.object({
        alias: Joi.array().items(Joi.string().pattern(nameRx)).single(),
        args: Joi.array().items(
            Joi.string(),
            Joi.object({
                name: Joi.string().pattern(nameRx).required(),
                ref: Joi.boolean(),
                assert: Joi.alternatives([
                    Joi.function(),
                    Joi.object().schema()
                ])
                    .conditional('ref', { is: true, then: Joi.required() }),
                normalize: Joi.function(),
                message: Joi.string().when('assert', { is: Joi.function(), then: Joi.required() })
            })
        ),
        convert: Joi.boolean(),
        manifest: Joi.boolean(),
        method: Joi.function().allow(false),
        multi: Joi.boolean(),
        validate: Joi.function()
    })
    schemas.extension = Joi.object({
        type: Joi.alternatives([
            Joi.string(),
            Joi.object().regex()
        ])
            .required(),
        args: Joi.function(),
        cast: Joi.object().pattern(nameRx, Joi.object({
            from: Joi.function().maxArity(1).required(),
            to: Joi.function().minArity(1).maxArity(2).required()
        })),
        base: Joi.object().schema()
            .when('type', { is: Joi.object().regex(), then: Joi.forbidden() }),
        coerce: [
            Joi.function().maxArity(3),
            Joi.object({ method: Joi.function().maxArity(3).required(), from: Joi.array().items(Joi.string()).single() })
        ],
        flags: Joi.object().pattern(nameRx, Joi.object({
            setter: Joi.string(),
            default: Joi.any()
        })),
        manifest: {
            build: Joi.function().arity(2)
        },
        messages: [Joi.object(), Joi.string()],
        modifiers: Joi.object().pattern(nameRx, Joi.function().minArity(1).maxArity(2)),
        overrides: Joi.object().pattern(nameRx, Joi.function()),
        prepare: Joi.function().maxArity(3),
        rebuild: Joi.function().arity(1),
        rules: Joi.object().pattern(nameRx, rule),
        terms: Joi.object().pattern(nameRx, Joi.object({
            init: Joi.array().allow(null).required(),
            manifest: Joi.object().pattern(/.+/, [
                Joi.valid('schema', 'single'),
                Joi.object({
                    mapped: Joi.object({
                        from: Joi.string().required(),
                        to: Joi.string().required()
                    })
                        .required()
                })
            ])
        })),
        validate: Joi.function().maxArity(3)
    })
        .strict()
    schemas.extensions = Joi.array().items(Joi.object(), Joi.function().arity(1)).strict()
    //Manifest
    const desc: Record<string, Base> = {
        buffer: Joi.object({
            buffer: Joi.string()
        }),
        func: Joi.object({
            function: Joi.function().required(),
            options: {
                literal: true
            }
        }),
        override: Joi.object({
            override: true
        }),
        ref: Joi.object({
            ref: Joi.object({
                type: Joi.valid('value', 'global', 'local'),
                path: Joi.array().required(),
                separator: Joi.string().length(1).allow(false),
                ancestor: Joi.number().min(0).integer().allow('root'),
                map: Joi.array().items(Joi.array().length(2)).min(1),
                adjust: Joi.function(),
                iterables: Joi.boolean(),
                in: Joi.boolean(),
                render: Joi.boolean()
            })
                .required()
        }),
        regex: Joi.object({
            regex: Joi.string().min(3)
        }),
        special: Joi.object({
            special: Joi.valid('deep').required()
        }),
        template: Joi.object({
            template: Joi.string().required(),
            options: Joi.object()
        }),
        value: Joi.object({
            value: Joi.alternatives([Joi.object(), Joi.array()]).required()
        })
    }
    desc.entity = Joi.alternatives([
        Joi.array().items(Joi.link('...')),
        Joi.boolean(),
        Joi.function(),
        Joi.number(),
        Joi.string(),
        desc.buffer,
        desc.func,
        desc.ref,
        desc.regex,
        desc.special,
        desc.template,
        desc.value,
        Joi.link('/')
    ])
    desc.values = Joi.array()
        .items(
            null,
            Joi.boolean(),
            Joi.function(),
            Joi.number().allow(Infinity, -Infinity),
            Joi.string().allow(''),
            Joi.symbol(),
            desc.buffer,
            desc.func,
            desc.override,
            desc.ref,
            desc.regex,
            desc.template,
            desc.value
        )
    desc.messages = Joi.object()
        .pattern(/.+/, [
            Joi.string(),
            desc.template,
            Joi.object().pattern(/.+/, [Joi.string(), desc.template])
        ])
    schemas.description = Joi.object({
        type: Joi.string().required(),
        flags: Joi.object({
            cast: Joi.string(),
            default: Joi.any(),
            description: Joi.string(),
            empty: Joi.link('/'),
            failover: desc.entity,
            id: Joi.string(),
            label: Joi.string(),
            only: true,
            presence: ['optional', 'required', 'forbidden'],
            result: ['raw', 'strip'],
            strip: Joi.boolean(),
            unit: Joi.string()
        })
            .unknown(),
        preferences: {
            allowUnknown: Joi.boolean(),
            abortEarly: Joi.boolean(),
            artifacts: Joi.boolean(),
            cache: Joi.boolean(),
            convert: Joi.boolean(),
            dateFormat: ['date', 'iso', 'string', 'time', 'utc'],
            errors: {
                escapeHtml: Joi.boolean(),
                label: ['path', 'key'],
                language: [
                    Joi.string(),
                    desc.ref
                ],
                wrap: {
                    label: wrap,
                    array: wrap
                }
            },
            externals: Joi.boolean(),
            messages: desc.messages,
            noDefaults: Joi.boolean(),
            nonEnumerables: Joi.boolean(),
            presence: ['required', 'optional', 'forbidden'],
            skipFunctions: Joi.boolean(),
            stripUnknown: Joi.object({
                arrays: Joi.boolean(),
                objects: Joi.boolean()
            })
                .or('arrays', 'objects')
                .allow(true, false),
            warnings: Joi.boolean()
        },
        allow: desc.values,
        invalid: desc.values,
        rules: Joi.array().min(1).items({
            name: Joi.string().required(),
            args: Joi.object().min(1),
            keep: Joi.boolean(),
            message: [
                Joi.string(),
                desc.messages
            ],
            warn: Joi.boolean()
        }),
        //Terms
        keys: Joi.object().pattern(/.*/, Joi.link('/')),
        link: desc.ref
    })
        .pattern(/^[a-z]\w*$/, Joi.any())
}

Lazy.schemas = getSchemas
