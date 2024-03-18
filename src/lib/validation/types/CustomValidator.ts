import {type ErrorReport} from 'joi'
import {type CustomHelpers} from '../interfaces/CustomHelpers.js'

export type CustomValidator<V = any, R = V> = (value: V, helpers: CustomHelpers<R>) => R | ErrorReport;
