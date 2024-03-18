import { type SchemaMap} from 'joi'
import {type Schema} from './Schema.js'

export type SchemaLikeWithoutArray = string | number | boolean | null | Schema | SchemaMap
