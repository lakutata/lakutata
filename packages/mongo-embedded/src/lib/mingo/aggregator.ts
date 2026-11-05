import { ComputeOptions, OpType, ProcessingMode } from './core/_internal.js'
import { Iterator, Lazy, Source } from './lazy.js'
import type { Any, AnyObject, Callback, Options } from './types.js'
import { assert, cloneDeep } from './util/index.js'

/**
 * The `Aggregator` class provides functionality to process data collections
 * through an aggregation pipeline. It supports streaming and executing
 * aggregation operations with customizable options.
 */
export class Aggregator {
  #pipeline: AnyObject[]
  #options: Options

  /**
   * Creates an instance of the Aggregator class.
   *
   * @param pipeline - An array of objects representing the aggregation pipeline stages.
   * @param options - Optional configuration settings for the aggregator.
   */
  constructor(pipeline: AnyObject[], options: Partial<Options>) {
    this.#pipeline = pipeline
    this.#options = ComputeOptions.init(options)
  }

  /**
   * Processes a collection through an aggregation pipeline and returns an iterator
   * for the transformed results.
   *
   * @param collection - The input collection to process. This can be any source
   *   that implements the `Source` interface.
   * @param options - Optional configuration for processing. If not provided, the
   *   default options of the aggregator instance will be used.
   * @returns An iterator that yields the results of the aggregation pipeline.
   *
   * @throws Will throw an error if:
   * - A pipeline stage contains more than one operator.
   * - The `$documents` operator is not the first stage in the pipeline.
   * - An unregistered pipeline operator is encountered.
   */
  stream(collection: Source, options?: Options): Iterator {
    let iter: Iterator = Lazy(collection)
    const opts = options ?? this.#options
    const mode = opts.processingMode

    // clone the input collection if requested.
    if (mode & ProcessingMode.CLONE_INPUT) iter.map(o => cloneDeep(o))

    // validate and build pipeline
    iter = this.#pipeline
      .map<[Callback<Iterator>, Any]>((stage, i) => {
        const keys = Object.keys(stage)
        assert(
          keys.length === 1,
          `aggregation stage must have single operator, got ${keys.toString()}.`
        )
        const name = keys[0]
        // may contain only one $documents operator which must be first in the pipeline.
        assert(
          name !== '$documents' || i == 0,
          '$documents must be first stage in pipeline.'
        )
        const op = opts.context.getOperator(OpType.PIPELINE, name)
        assert(!!op, `unregistered pipeline operator ${name}.`)
        return [op, stage[name]] as [Callback<Iterator>, Any]
      })
      .reduce((acc, [op, expr]) => op(acc, expr, opts), iter)

    // operators that may share object graphs of inputs.
    if (mode & ProcessingMode.CLONE_OUTPUT) iter.map(o => cloneDeep(o))

    return iter
  }

  /**
   * Executes the aggregation pipeline on the provided collection and returns the resulting array.
   *
   * @template T - The type of the objects in the resulting array.
   * @param collection - The input data source to run the aggregation on.
   * @param options - Optional settings to customize the aggregation behavior.
   * @returns An array of objects of type `T` resulting from the aggregation.
   */
  run<T extends AnyObject>(collection: Source, options?: Options): T[] {
    return this.stream(collection, options).collect()
  }
}
