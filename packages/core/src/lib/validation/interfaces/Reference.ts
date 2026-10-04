import {ReferenceOptions} from './ReferenceOptions.js'

/**
 * A reference to another value, resolved during the validation: a sibling key (`'b'`), a key of an ancestor
 * (`'...b'`, `'/root.key'`), or a value of the global context (`'$key'`). Created by `DTO.Ref(key)` (`DTO.In(key)` for
 * a list of values), and given in place of a value to the rules accepting one (`min()`, `valid()`, `default()`…).
 */
export interface Reference extends Exclude<ReferenceOptions, 'prefix'> {
    /**
     * The number of keys in the path.
     */
    depth: number
    /**
     * What the reference reaches: `value` (the validated value), `global` (the `context` validation option) or `local`
     * (the context of an error message).
     */
    type: string
    /**
     * The path joined by the separator (`'a.b'`), or null for the reference to the value itself.
     */
    key: string
    /**
     * The first key of the path.
     */
    root: string
    /**
     * The keys of the path, from the starting point of the reference.
     */
    path: string[]
    /**
     * The text of the reference in the descriptions and the error messages, like `ref:a.b` or `ref:global:key`.
     */
    display: string

    /**
     * The text of the reference (`display`).
     * @returns The text, like `ref:a.b`.
     */
    toString(): string
}
