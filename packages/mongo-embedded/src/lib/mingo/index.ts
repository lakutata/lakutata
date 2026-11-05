import { Aggregator as AggregatorBase } from './aggregator.js'
import { Context, ProcessingMode } from './core/_internal.js'
import { Cursor } from './cursor.js'
import type { Source } from './lazy.js'
import * as accumulatorOperators from './operators/accumulator/index.js'
import * as expressionOperators from './operators/expression/index.js'
import * as pipelineOperators from './operators/pipeline/index.js'
import * as projectionOperators from './operators/projection/index.js'
import * as queryOperators from './operators/query/index.js'
import * as windowOperators from './operators/window/index.js'
import { Query as QueryBase } from './query.js'
import type { AnyObject, Criteria, Options, Projection } from './types.js'
import * as updater from './updater.js'

export { Context, ProcessingMode } from './core/index.js'

const CONTEXT = Context.init({
  accumulator: accumulatorOperators,
  expression: expressionOperators,
  pipeline: pipelineOperators,
  projection: projectionOperators,
  query: queryOperators,
  window: windowOperators
})

const makeOpts = (options?: Partial<Options>) =>
  Object.assign({
    ...options,
    context: options?.context
      ? Context.from(CONTEXT, options?.context)
      : CONTEXT
  }) as Options

export class Query<T = AnyObject> extends QueryBase<T> {
  constructor(condition: Criteria<T>, options?: Partial<Options>) {
    super(condition, makeOpts(options))
  }
}

export class Aggregator extends AggregatorBase {
  constructor(pipeline: AnyObject[], options?: Partial<Options>) {
    super(pipeline, makeOpts(options))
  }
}

/**
 * Finds documents in a collection that match the specified criteria.
 *
 * @template R - The type of the documents in the collection.
 * @param collection - The source collection to search.
 * @param condition - The query criteria to filter the documents.
 * @param projection - Optional. Specifies the fields to include or exclude in the returned documents.
 * @param options - Optional. Additional options to customize the query behavior.
 * @returns A `Cursor` object that allows iteration over the matching documents.
 */
export function find<R = AnyObject, T = AnyObject>(
  collection: Source,
  condition: Criteria<T>,
  projection?: Projection<R>,
  options?: Partial<Options>
): Cursor<R> {
  return new Query<T>(condition, makeOpts(options)).find<R>(
    collection,
    projection
  )
}

/**
 * Performs an aggregation operation on the provided collection using the specified pipeline.
 *
 * @param collection - The input data source to aggregate.
 * @param pipeline - An array of aggregation stages to process the collection.
 * @param options - Optional settings to customize the aggregation behavior.
 * @returns The result of the aggregation as an array of objects.
 */
export function aggregate(
  collection: Source,
  pipeline: AnyObject[],
  options?: Partial<Options>
): AnyObject[] {
  return new Aggregator(pipeline, makeOpts(options)).run(collection)
}

export function update<T extends AnyObject>(
  obj: T,
  modifier: updater.Modifier<T>,
  arrayFilters?: AnyObject[],
  condition?: Criteria<T>,
  options?: {
    cloneMode?: updater.CloneMode
    queryOptions?: Partial<Options>
  }
) {
  return updater.update(obj, modifier, arrayFilters, condition, {
    cloneMode: options?.cloneMode,
    queryOptions: makeOpts(options?.queryOptions)
  })
}

export function updateMany<T extends AnyObject>(
  documents: T[],
  condition: Criteria<T>,
  modifer: updater.Modifier<T> | updater.PipelineStage[],
  updateConfig: updater.UpdateConfig = {},
  options?: Partial<Options>
) {
  return updater.updateMany(
    documents,
    condition,
    modifer,
    updateConfig,
    makeOpts(options)
  )
}

export function updateOne<T extends AnyObject>(
  documents: T[],
  condition: Criteria<T>,
  modifier: updater.Modifier<T> | updater.PipelineStage[],
  updateConfig: updater.UpdateConfig = {},
  options?: Partial<Options>
) {
  return updater.updateOne(
    documents,
    condition,
    modifier,
    updateConfig,
    makeOpts(options)
  )
}

export default {
  Aggregator,
  Context,
  ProcessingMode,
  Query,
  aggregate,
  find,
  update,
  updateMany,
  updateOne
}
