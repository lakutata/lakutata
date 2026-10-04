import {HierarchySeparatorOptions} from './HierarchySeparatorOptions.js'

/**
 * The options of a reference created by `DTO.Ref()` or `DTO.In()`: how its key is read and how the value it resolves to
 * is adjusted.
 */
export interface ReferenceOptions extends HierarchySeparatorOptions {
    /**
     * A function adjusting the resolved value, like `(value) => value + 5`. The adjusted value is not validated: it
     * must be what the rule using the reference expects. Cannot be combined with `map`.
     */
    adjust?: (value: any) => any

    /**
     * Pairs `[[from, to], …]` mapping the resolved value to another one; a value not in the map is used as is. Cannot
     * be combined with `adjust`.
     */
    map?: Array<[any, any]>

    /**
     * The characters marking the kind of a reference at the start of its key.
     */
    prefix?: {
        /**
         * The prefix of the references to the `context` validation option.
         * @default '$'
         */
        global?: string

        /**
         * The prefix of the references to the context of an error message or a rule.
         * @default '#'
         */
        local?: string

        /**
         * The prefix of the references to the root value being validated.
         * @default '/'
         */
        root?: string
    }

    /**
     * The starting point of the reference: 0 for the value itself, 1 for its parent (the object holding it), 2 for the
     * grandparent… Cannot be combined with a key starting with separators (`'...a'`).
     * @default the number of leading separators of the key, else 1
     */
    ancestor?: number

    /**
     * Whether the reference resolves to an array of values the value must be one of (what `DTO.In()` creates), in
     * `valid()` and `invalid()`.
     * @default false
     */
    in?: boolean

    /**
     * Whether the path reaches into the `Map` and `Set` objects.
     * @default false
     */
    iterables?: boolean

    /**
     * Whether the error messages show the resolved value instead of the name of the reference.
     * @default false
     */
    render?: boolean
}
