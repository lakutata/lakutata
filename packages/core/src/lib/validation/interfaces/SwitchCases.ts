import {SchemaLike} from '../types/SchemaLike.js'

export interface SwitchCases {
    /**
     * the required condition schema type.
     */
    is: SchemaLike
    /**
     * the alternative schema type if the condition is true.
     */
    then: SchemaLike
}
