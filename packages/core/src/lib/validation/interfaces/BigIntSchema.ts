import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

export interface BigIntSchema<T = bigint> extends AnySchema<T> {
    greater(limit: bigint | Reference): this;

    less(limit: bigint | Reference): this;

    max(limit: bigint | Reference): this;

    min(limit: bigint | Reference): this;

    multiple(base: bigint | Reference): this;

    negative(): this;

    port(): this;

    positive(): this;

    sign(sign: 'positive' | 'negative'): this;
}