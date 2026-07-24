import {AnySchema} from './AnySchema.js'
import Joi from 'joi'
import {SchemaLike} from '../types/SchemaLike.js'
import {SchemaLikeWithoutArray} from '../types/SchemaLikeWithoutArray.js'
import {Reference} from './Reference.js'
import {NoNestedArrays} from '../types/NoNestedArrays.js'
import {UnwrapSchemaLikeWithoutArray} from '../types/UnwrapSchemaLikeWithoutArray.js'

export interface ArraySchema<TSchema = any[]> extends AnySchema<TSchema> {
    /**
     * Verifies that an assertion passes for at least one item in the array, where:
     * `schema` - the validation rules required to satisfy the assertion. If the `schema` includes references, they are resolved against
     * the array item being tested, not the value of the `ref` target.
     */
    has(schema: SchemaLike): this;

    // /**
    //  * List the types allowed for the array values.
    //  * If a given type is .required() then there must be a matching item in the array.
    //  * If a type is .forbidden() then it cannot appear in the array.
    //  * Required items can be added multiple times to signify that multiple items must be found.
    //  * Errors will contain the number of items that didn't match.
    //  * Any unmatched item having a label will be mentioned explicitly.
    //  *
    //  * @param types - a joi schema object to validate each array item against.
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
     * @param type - a joi schema object to validate each array item against.
     */
    items<A>(a: SchemaLikeWithoutArray<A>): ArraySchema<A[]>;
    items<A, B>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>
    ): ArraySchema<(A | B)[]>;
    items<A, B, C>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>
    ): ArraySchema<(A | B | C)[]>;
    items<A, B, C, D>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>,
        d: SchemaLikeWithoutArray<D>
    ): ArraySchema<(A | B | C | D)[]>;
    items<A, B, C, D, E>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>,
        d: SchemaLikeWithoutArray<D>,
        e: SchemaLikeWithoutArray<E>
    ): ArraySchema<(A | B | C | D | E)[]>;
    items<A, B, C, D, E, F>(
        a: SchemaLikeWithoutArray<A>,
        b: SchemaLikeWithoutArray<B>,
        c: SchemaLikeWithoutArray<C>,
        d: SchemaLikeWithoutArray<D>,
        e: SchemaLikeWithoutArray<E>,
        f: SchemaLikeWithoutArray<F>
    ): ArraySchema<(A | B | C | D | E | F)[]>;
    items<
        TItems,
        TTItems extends SchemaLikeWithoutArray<TItems>[] = SchemaLikeWithoutArray<TItems>[]
    >(
        ...types: NoNestedArrays<TTItems>
    ): ArraySchema<
        {
            [I in keyof TTItems]: UnwrapSchemaLikeWithoutArray<TTItems[I]>;
        }[number][]
    >;

    /**
     * Specifies the exact number of items in the array.
     */
    length(limit: number | Reference): this;

    /**
     * Specifies the maximum number of items in the array.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the minimum number of items in the array.
     */
    min(limit: number | Reference): this;

    /**
     * Lists the types in sequence order for the array values where:
     * @param type - a joi schema object to validate against each array item in sequence order. type can be multiple values passed as individual arguments.
     * If a given type is .required() then there must be a matching item with the same index position in the array.
     * Errors will contain the number of items that didn't match.
     * Any unmatched item having a label will be mentioned explicitly.
     */
    ordered(...types: SchemaLikeWithoutArray[]): this;

    /**
     * Allow single values to be checked against rules as if it were provided as an array.
     * enabled can be used with a falsy value to go back to the default behavior.
     */
    single(enabled?: any): this;

    /**
     * Sorts the array by given order.
     */
    sort(options?: Joi.ArraySortOptions): this;

    /**
     * Allow this array to be sparse.
     * enabled can be used with a falsy value to go back to the default behavior.
     */
    sparse(enabled?: any): this;

    /**
     * Requires the array values to be unique.
     * Remember that if you provide a custom comparator function,
     * different types can be passed as parameter depending on the rules you set on items.
     * Be aware that a deep equality is performed on elements of the array having a type of object,
     * a performance penalty is to be expected for this kind of operation.
     */
    unique(comparator?: string | Joi.ComparatorFunction, options?: Joi.ArrayUniqueOptions): this;
}
