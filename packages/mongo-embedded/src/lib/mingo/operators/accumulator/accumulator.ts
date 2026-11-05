import { ComputeOptions, evalExpr } from '../../core/_internal.js'
import { Any, Callback, Options } from '../../types.js'
import { assert } from '../../util/index.js'
import { $push } from './push.js'

interface AccumulatorExpr {
  /** Function used to initialize the state. */
  readonly init: Callback<Any>
  /** Arguments passed to the init function. */
  readonly initArgs?: Any[]
  /** Function used to accumulate documents.*/
  readonly accumulate: Callback<Any>
  /** Arguments passed to the accumulate function. */
  readonly accumulateArgs: Any[]
  /** unused */
  readonly merge?: Callback<Any>
  /** Function used to update the result of the accumulation. */
  readonly finalize?: Callback<Any>
  readonly lang: 'js'
}

/** Defines a custom accumulator function. */
export const $accumulator = (coll: Any[], expr: Any, options: Options) => {
  assert(
    options.scriptEnabled,
    "$accumulator requires 'scriptEnabled' option to be true"
  )

  const copts = ComputeOptions.init(options)
  const input = expr as AccumulatorExpr

  const initArgs = evalExpr(
    copts?.local?.groupId,
    input.initArgs || [],
    copts.update({ root: copts?.local?.groupId })
  ) as Any[]

  const args = $push(coll, input.accumulateArgs, copts) as Any[][]
  for (let i = 0; i < args.length; i++) {
    for (let j = 0; j < args[i].length; j++) {
      args[i][j] = args[i][j] ?? null
    }
  }

  const initialValue = input.init.apply(null, initArgs) as Any
  const f = input.accumulate
  let result = initialValue
  for (let i = 0; i < args.length; i++) {
    result = f.apply(null, [result, ...args[i]]) as Any
  }
  if (input.finalize) result = input.finalize.call(null, result)
  return result
}
