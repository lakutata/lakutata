import {type ExternalHelpers} from '../interfaces/ExternalHelpers.js'

export type ExternalValidationFunction<V = any, R = V> = (value: V, helpers: ExternalHelpers<R>) => R | undefined;
