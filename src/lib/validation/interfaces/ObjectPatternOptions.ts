import {type Reference} from 'joi'
import {type SchemaLike} from '../types/SchemaLike.js'

export interface ObjectPatternOptions {
    fallthrough?: boolean;
    matches: SchemaLike | Reference;
}
