import {SchemaLike} from '../types/SchemaLike.js'

export interface SwitchDefault {
    /**
     * the alternative schema type if no cases matched.
     * Only one otherwise statement is allowed in switch as the last array item.
     */
    otherwise: SchemaLike;
}
