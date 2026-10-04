import {AnySchema} from './AnySchema.js'
import {SchemaLike} from '../types/SchemaLike.js'
import {SchemaLikeWithoutArray} from '../types/SchemaLikeWithoutArray.js'
import {Reference} from './Reference.js'
import {NoNestedArrays} from '../types/NoNestedArrays.js'
import {UnwrapSchemaLikeWithoutArray} from '../types/UnwrapSchemaLikeWithoutArray.js'
import {ArraySortOptions} from './ArraySortOptions.js'
import {ArrayUniqueOptions} from './ArrayUniqueOptions.js'
import {ComparatorFunction} from '../types/ComparatorFunction.js'

/**
 * A schema of arrays, built by `DTO.Array(...itemSchemas)`: the schemas of its items, their number, order and
 * uniqueness. Without items given, the items may be anything.
 * @typeParam TSchema The type of the arrays the schema validates.
 */
export interface ArraySchema<TSchema = any[]> extends AnySchema<TSchema> {
    /**
     * Require items matching a schema: at least one by default.
     * @param schema The schema the matching items match. Its references are resolved against the item tested, not
     * against the array.
     * @param options `min` and `max`, the number of matching items required (non-negative integers): by default at
     * least one, no maximum.
     * @returns A new schema.
     */
    has(schema: SchemaLike, options?: { min?: number, max?: number }): this

    // /**
    //  * List the types allowed for the array values.
    //  * If a given type is .required() then there must be a matching item in the array.
    //  * If a type is .forbidden() then it cannot appear in the array.
    //  * Required items can be added multiple times to signify that multiple items must be found.
    //  * Errors will contain the number of items that didn't match.
    //  * Any unmatched item having a label will be mentioned explicitly.
    //  *
    //  * @param types - a schema object to validate each array item against.
    //  */
    // items<TSchema = any[]>(...types: SchemaLikeWithoutArray[]): this;

    /**
     * List the types allowed for the array values.
     * If a given type is .required() then there must be a matching item in the array.
     * If a type is .forbidden() then it cannot appear in the array.
     * Required items can be added multiple times to signify that multiple items must be found.
     * Errors will contain the number of items that didn't match.
     * Any unmatched item having a label will be mentioned explicitly.
     *
     * @param a The schema of the items. With several schemas (more arguments), each item must match one of them.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When an item schema is an array schema and `single()` is enabled.
     */
    items<A>(a: SchemaLikeWithoutArray<A>): ArraySchema<A[]>
    items<A, B>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>
    ): ArraySchema<(A | B)[]>
    items<A, B, C>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>
    ): ArraySchema<(A | B | C)[]>
    items<A, B, C, D>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>,
        d: SchemaLikeWithoutArray<D>
    ): ArraySchema<(A | B | C | D)[]>
    items<A, B, C, D, E>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>,
        d: SchemaLikeWithoutArray<D>,
        e: SchemaLikeWithoutArray<E>
    ): ArraySchema<(A | B | C | D | E)[]>
    items<A, B, C, D, E, F>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>,
        d: SchemaLikeWithoutArray<D>,
        e: SchemaLikeWithoutArray<E>,
        f: SchemaLikeWithoutArray<F>
    ): ArraySchema<(A | B | C | D | E | F)[]>
    items<
        TItems,
        TTItems extends SchemaLikeWithoutArray<TItems>[] = SchemaLikeWithoutArray<TItems>[]
    >(
        ...types: NoNestedArrays<TTItems>
    ): ArraySchema<
        {
            [I in keyof TTItems]: UnwrapSchemaLikeWithoutArray<TTItems[I]>;
        }[number][]
    >

    /**
     * Require an exact number of items.
     * @param limit The number of items, or a reference to another value holding it.
     * @returns A new schema.
     */
    length(limit: number | Reference): this

    /**
     * Require at most a number of items.
     * @param limit The maximum number of items (inclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    max(limit: number | Reference): this

    /**
     * Require at least a number of items.
     * @param limit The minimum number of items (inclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    min(limit: number | Reference): this

    /**
     * List the schemas of the items by position (a tuple): the first item matches the first schema, and so on. An
     * item of a `required()` schema must be present; the items beyond the list are not allowed unless `items()`
     * allows them. Any unmatched item having a label is mentioned in the error.
     * @param types The schemas of the items, in order.
     * @returns A new schema.
     */
    ordered(...types: SchemaLikeWithoutArray[]): this

    /**
     * Accept a single value which is not an array, validated as an array of that one item (and returned as such).
     * @param enabled Whether a single value is accepted: a falsy value restores the default (rejected). Defaults to
     * true.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the items are arrays.
     */
    single(enabled?: any): this

    /**
     * Require the items to be sorted; with conversion enabled (`strict(false)`), the array is sorted instead.
     * @param options `order`: `ascending` (the default) or `descending`; `by`: the key (or reference) of the items to
     * sort by, the items themselves by default.
     * @returns A new schema.
     */
    sort(options?: ArraySortOptions): this

    /**
     * Allow the array to be sparse: undefined items (holes) are rejected by default.
     * @param enabled Whether undefined items are allowed: a falsy value restores the default. Defaults to true.
     * @returns A new schema.
     */
    sparse(enabled?: any): this

    /**
     * Require the items to be unique, compared by deep equality for the objects (which has a cost on large arrays).
     * @param comparator The key path of the items to compare (`'id'`, `'a.b'`), or a function telling whether two items
     * are duplicates (the items it receives are of the types the item schemas accept). By default the items themselves
     * are compared.
     * @param options `ignoreUndefined`: with a key path, whether items without the key are ignored instead of being
     * duplicates of each other (default false); `separator`: the separator of the key path (default `.`).
     * @returns A new schema.
     */
    unique(comparator?: string | ComparatorFunction, options?: ArrayUniqueOptions): this
}
