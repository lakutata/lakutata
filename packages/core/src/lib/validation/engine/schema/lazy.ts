/**
 * Registry of modules which the upstream library required lazily (inside functions) to keep its module load order
 * (derived from the upstream library, see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md).
 * The registered modules add themselves when they are loaded; users read them at runtime only.
 */
import type {SchemaLike} from './model.js'

export interface LazyMessages {
    compile(messages: unknown, target?: unknown): unknown
}

export interface LazyTemplate {
    isTemplate(template: unknown): boolean
}

export interface LazySchemas {
    preferences: SchemaLike
    [name: string]: SchemaLike
}

export const Lazy: {
    messages: LazyMessages | undefined
    template: LazyTemplate | undefined
    schemas: (() => LazySchemas) | undefined
} = {
    messages: undefined,
    template: undefined,
    schemas: undefined
}
