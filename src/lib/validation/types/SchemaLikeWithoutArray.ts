import { SchemaMap} from 'joi'
import {Schema} from './Schema.js'

export type SchemaLikeWithoutArray = string | number | boolean | null | Schema | SchemaMap
