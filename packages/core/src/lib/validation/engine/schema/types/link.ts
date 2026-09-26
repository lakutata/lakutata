/**
 * Derived from the upstream lib/types/link.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../assert.js'
import type {Base, SchemaTerms} from '../base.js'
import * as Common from '../common.js'
import * as Compile from '../compile.js'
import * as Errors from '../errors.js'
import type {PathKey, Preferences, SchemaInternals, ValidationHelpers, ValidationOutcome} from '../model.js'
import type * as Ref from '../ref.js'
import type {State, StateSchemaEntry} from '../state.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'

/**
 * The terms of a link schema
 */
export interface LinkTerms {
    link: { ref: Ref.Ref }[] | null
}

/**
 * The link schema: validates with the schema a reference points to
 */
export interface LinkSchema extends AnySchema {
    $_terms: SchemaTerms & AnyTerms & LinkTerms
    ref(ref: unknown): this
    relative(enabled?: boolean): this
}

/**
 * The schema a link reference is resolved from, and the path of the linked schema from it
 */
interface Perspective {
    perspective: Base | null | undefined
    path: PathKey[] | null
}

const Link: LinkSchema = Any.extend<LinkSchema>({

    type: 'link',

    properties: {
        schemaChain: true
    },

    terms: {

        link: {init: null, manifest: 'single', register: false}
    },

    args(schema: LinkSchema, ref: unknown): LinkSchema {
        return schema.ref(ref)
    },

    validate(value: unknown, {schema, state, prefs}: ValidationHelpers<LinkSchema>): ValidationOutcome {
        assert(schema.$_terms.link, 'Uninitialized link schema')
        const linked: Base = generate(schema, value, state, prefs)
        const ref: Ref.Ref = schema.$_terms.link[0].ref
        return linked.$_validate(value, state.nest(linked, `link:${ref.display}:${linked.type}`), prefs)
    },

    generate(schema: LinkSchema, value: unknown, state: State, prefs: Preferences): LinkSchema {
        //The linked schema, of any type
        return generate(schema, value, state, prefs) as LinkSchema
    },

    rules: {

        ref: {
            method(this: LinkSchema, ref: unknown): LinkSchema {
                assert(!this.$_terms.link, 'Cannot reinitialize schema')
                const compiled: Ref.Ref = Compile.ref(ref)
                assert(compiled.type === 'value' || compiled.type === 'local', 'Invalid reference type:', compiled.type)
                assert(compiled.type === 'local' || compiled.ancestor === 'root' || (compiled.ancestor as number) > 0, 'Link cannot reference itself')
                const obj: LinkSchema = this.clone()
                obj.$_terms.link = [{ref: compiled}]
                return obj
            }
        },

        relative: {
            method(this: LinkSchema, enabled: boolean = true): LinkSchema {
                return this.$_setFlag('relative', enabled)
            }
        }
    },

    overrides: {

        concat(this: LinkSchema, source: Base): LinkSchema {
            assert(this.$_terms.link, 'Uninitialized link schema')
            assert(Common.isSchema(source), 'Invalid schema object')
            assert(source.type !== 'link', 'Cannot merge type link with another link')
            const obj: LinkSchema = this.clone()
            if (!obj.$_terms.whens) {
                obj.$_terms.whens = []
            }
            obj.$_terms.whens.push({concat: source})
            return obj.$_mutateRebuild()
        }
    },

    manifest: {

        build(obj: LinkSchema, desc: Record<string, unknown>): LinkSchema {
            assert(desc.link, 'Invalid link description missing link')
            return obj.ref(desc.link)
        }
    }
})

export default Link

//Helpers

function generate(schema: LinkSchema, value: unknown, state: State, prefs: Preferences): Base {
    const links: Map<SchemaInternals, SchemaInternals> = state.mainstay.links as Map<SchemaInternals, SchemaInternals>
    let linked: Base | undefined = links.get(schema)
    if (linked) {
        return linked._generate(value, state, prefs).schema
    }
    const ref: Ref.Ref = (schema.$_terms.link as { ref: Ref.Ref }[])[0].ref
    const {perspective, path} = perspectiveOf(ref, state)
    assertLink(perspective, 'which is outside of schema boundaries', ref, schema, state, prefs)
    try {
        linked = (path as PathKey[]).length ? (perspective as Base).$_reach(path as string[]) : perspective as Base
    } catch {
        assertLink(false, 'to non-existing schema', ref, schema, state, prefs)
    }
    assertLink((linked as Base).type !== 'link', 'which is another link', ref, schema, state, prefs)
    if (!schema._flags.relative) {
        links.set(schema, linked as Base)
    }
    return (linked as Base)._generate(value, state, prefs).schema
}

function perspectiveOf(ref: Ref.Ref, state: State): Perspective {
    const schemas: StateSchemaEntry[] = state.schemas as StateSchemaEntry[]
    if (ref.type === 'local') {
        //From parent to root
        for (const {schema, key} of schemas) {
            const entry: AnySchema = schema as AnySchema
            const id: PathKey | undefined = entry._flags.id || key
            if (id === ref.path[0]) {
                return {perspective: entry, path: ref.path.slice(1)}
            }
            if (entry.$_terms.shared) {
                for (const shared of entry.$_terms.shared) {
                    if (shared._flags.id === ref.path[0]) {
                        return {perspective: shared, path: ref.path.slice(1)}
                    }
                }
            }
        }
        return {perspective: null, path: null}
    }
    if (ref.ancestor === 'root') {
        return {perspective: schemas[schemas.length - 1].schema as Base, path: ref.path}
    }
    return {perspective: schemas[ref.ancestor as number] && schemas[ref.ancestor as number].schema as Base, path: ref.path}
}

function assertLink(condition: unknown, message: string, ref: Ref.Ref, schema: LinkSchema, state: State, prefs: Preferences): void {
    //Manual check to avoid generating error message on success
    if (condition) {
        return
    }
    assert(false, `"${Errors.label(schema._flags, state, prefs, undefined)}" contains link reference "${ref.display}" ${message}`)
}
