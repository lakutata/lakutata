import {type SchemaLike} from '../types/SchemaLike.js'
import {type SwitchCases} from './SwitchCases.js'
import {type SwitchDefault} from './SwitchDefault.js'

export interface WhenOptions {
    /**
     * the required condition joi type.
     */
    is?: SchemaLike;

    /**
     * the negative version of `is` (`then` and `otherwise` have reverse
     * roles).
     */
    not?: SchemaLike;

    /**
     * the alternative schema type if the condition is true. Required if otherwise or switch are missing.
     */
    then?: SchemaLike;

    /**
     * the alternative schema type if the condition is false. Required if then or switch are missing.
     */
    otherwise?: SchemaLike;

    /**
     * the list of cases. Required if then is missing.  Required if then or otherwise are missing.
     */
    switch?: Array<SwitchCases | SwitchDefault>;

    /**
     * whether to stop applying further conditions if the condition is true.
     */
    break?: boolean;
}
