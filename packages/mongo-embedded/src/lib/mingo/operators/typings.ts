import type * as accumulatorOperators from './accumulator/index.js'
import type * as expressionOperators from './expression/index.js'
import type * as pipelineOperators from './pipeline/index.js'
import type * as projectionOperators from './projection/index.js'
import type * as queryOperators from './query/index.js'
import type * as updateOperators from './update/index.js'
import type * as windowOperators from './window/index.js'

// keep only functions
type ExportedFunc<T> = T extends (...args: any[]) => any ? T : never  

type T_ACCUMULATOR = typeof accumulatorOperators
type T_EXPRESSION = typeof expressionOperators
type T_PIPELINE = typeof pipelineOperators
type T_PROJECTION = typeof projectionOperators
type T_QUERY = typeof queryOperators
type T_UPDATE = typeof updateOperators
type T_WINDOW = typeof windowOperators

// union of call signatures (preserves parameter/return shapes)
type OpFunc<T> =
  ExportedFunc<T> extends (...args: infer A) => infer R
    ? (...args: A) => R
    : never

export type AccumulatorOperator = OpFunc<T_ACCUMULATOR[keyof T_ACCUMULATOR]>
export type ExpressionOperator = OpFunc<T_EXPRESSION[keyof T_EXPRESSION]>
export type PipelineOperator = OpFunc<T_PIPELINE[keyof T_PIPELINE]>
export type ProjectionOperator = OpFunc<T_PROJECTION[keyof T_PROJECTION]>
export type QueryOperator = OpFunc<T_QUERY[keyof T_QUERY]>
export type UpdateOperator = OpFunc<T_UPDATE[keyof T_UPDATE]>
export type WindowOperator = OpFunc<T_WINDOW[keyof T_WINDOW]>

export type Operator =
  | AccumulatorOperator
  | ExpressionOperator
  | PipelineOperator
  | ProjectionOperator
  | QueryOperator
  | WindowOperator
