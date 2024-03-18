import {type AnySchema} from './AnySchema.js'
import {
    type ArraySortOptions,
    type ArrayUniqueOptions,
    type ComparatorFunction,
    type Reference
} from 'joi'
import {type SchemaLike} from '../types/SchemaLike.js'
import {type SchemaLikeWithoutArray} from '../types/SchemaLikeWithoutArray.js'

export interface ArraySchema<TSchema = any[]> extends AnySchema<TSchema> {
    /**
     * Verifies that an assertion passes for at least one item in the array, where:
     * `schema` - the validation rules required to satisfy the assertion. If the `schema` includes references, they are resolved against
     * the array item being tested, not the value of the `ref` target.
     */
    has(schema: SchemaLike): this;

    /**
     * List the types allowed for the array values.
     * If a given type is .required() then there must be a matching item in the array.
     * If a type is .forbidden() then it cannot appear in the array.
     * Required items can be added multiple times to signify that multiple items must be found.
     * Errors will contain the number of items that didn't match.
     * Any unmatched item having a label will be mentioned explicitly.
     *
     * @param types - a joi schema object to validate each array item against.
     */
    items(...types: SchemaLikeWithoutArray[]): this;

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
    sort(options?: ArraySortOptions): this;

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
    unique(comparator?: string | ComparatorFunction, options?: ArrayUniqueOptions): this;
}
