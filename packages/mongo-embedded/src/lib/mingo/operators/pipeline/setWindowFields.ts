import { ComputeOptions, OpType } from '../../core/_internal.js'
import { concat, Iterator, Lazy } from '../../lazy.js'
import { Any, AnyObject, Callback, Options } from '../../types.js'
import { assert, isNumber, isOperator, isString } from '../../util/index.js'
import { $function } from '../expression/custom/function.js'
import { $dateAdd } from '../expression/date/dateAdd.js'
import {
  Boundary,
  SetWindowFieldsInput,
  WindowOutputOption
} from '../window/_internal.js'
import { $addFields } from './addFields.js'
import { $group } from './group.js'
import { $sort } from './sort.js'

// Operators that require 'sortBy' option.
const SORT_REQUIRED_OPS: string[] = [
  '$denseRank',
  '$documentNumber',
  '$first',
  '$last',
  '$linearFill',
  '$rank',
  '$shift'
] as const

// Operators that require unbounded 'window' option.
const WINDOW_UNBOUNDED_OPS: string[] = [
  '$denseRank',
  '$expMovingAvg',
  '$linearFill',
  '$locf',
  '$rank',
  '$shift'
] as const

/** Checks whether the specified window is unbounded. */
const isUnbounded = (window: WindowOutputOption): boolean => {
  const boundary = window?.documents || window?.range
  return (
    !boundary || (boundary[0] === 'unbounded' && boundary[1] === 'unbounded')
  )
}

const OP = '$setWindowFields'

/**
 * Groups documents into windows and applies one or more operators to the documents in each window.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/setWindowFields/ usage}.
 */
export function $setWindowFields(
  coll: Iterator,
  expr: SetWindowFieldsInput,
  options: Options
): Iterator {
  options = ComputeOptions.init(options)
  options.context.addExpressionOps({ $function })

  const operators: Record<string, string> = {}

  // validate inputs early since this can be an expensive operation.
  const outputFields = Object.keys(expr.output)
  for (const field of outputFields) {
    const outputExpr = expr.output[field]
    const keys = Object.keys(outputExpr)
    const op = keys.find(isOperator)
    const context = options.context
    assert(
      op &&
        (!!context.getOperator(OpType.WINDOW, op) ||
          !!context.getOperator(OpType.ACCUMULATOR, op)),
      `${OP} '${op}' is not a valid window operator`
    )

    assert(
      keys.length > 0 &&
        keys.length <= 2 &&
        (keys.length == 1 || keys.includes('window')),
      `${OP} 'output' option should have a single window operator.`
    )

    if (outputExpr?.window) {
      const { documents, range } = outputExpr.window
      assert(
        (+!!documents ^ +!!range) === 1,
        "'window' option supports only one of 'documents' or 'range'."
      )
    }

    operators[field] = op!
  }

  // we sort first if required
  if (expr.sortBy) {
    coll = $sort(coll, expr.sortBy, options)
  }

  // then partition collection
  coll = $group(
    coll,
    {
      _id: expr.partitionBy,
      items: { $push: '$$CURRENT' }
    },
    options
  )

  // transform values
  return coll.transform((partitions: Any[]) => {
    // let iteratorIndex = 0;
    const iterators: Iterator[] = []
    const outputConfig: Array<{
      operatorName: string
      func: {
        left: Callback | null
        right: Callback | null
      }
      args: Any
      field: string
      window?: WindowOutputOption
    }> = []

    for (const field of outputFields) {
      const outputExpr = expr.output[field]
      const op = operators[field]

      const config = {
        operatorName: op,
        func: {
          left: options.context.getOperator(OpType.ACCUMULATOR, op),
          right: options.context.getOperator(OpType.WINDOW, op)
        },
        args: outputExpr[op],
        field: field,
        window: outputExpr.window
      }
      const unbounded = isUnbounded(config.window!)
      // sortBy option required for specific operators or bounded window.
      if (unbounded == false || SORT_REQUIRED_OPS.includes(op)) {
        const suffix = unbounded ? `'${op}'` : 'bounded window operations'
        assert(expr.sortBy, `${OP} 'sortBy' is required for ${suffix}.`)
      }
      // window must be unbounded for specific operators.
      assert(
        unbounded || !WINDOW_UNBOUNDED_OPS.includes(op),
        `${OP} cannot use bounded window for operator '${op}'.`
      )
      outputConfig.push(config)
    }

    // each parition maintains its own closure to process the documents in the window.
    for (const group of partitions as { items: AnyObject[] }[]) {
      // get the items to process
      const items = group.items

      // create an iterator per group.
      // we need the index of each document so we track it using a special field.
      let iterator = Lazy(items)

      // results map
      const windowResultMap: Record<string, (_: AnyObject) => Any> = {}

      for (const config of outputConfig) {
        const { func, args, field, window } = config
        const makeResultFunc = (
          getItemsFn: (_: AnyObject, i: number) => AnyObject[]
        ) => {
          // closure for object index within the partition
          let index = -1
          return (obj: AnyObject) => {
            ++index

            // process accumulator function
            if (func.left) {
              return func.left(getItemsFn(obj, index), args, options)
            } else if (func.right) {
              // OR process 'window' function
              return func.right(
                obj,
                getItemsFn(obj, index),
                {
                  parentExpr: expr,
                  inputExpr: args,
                  documentNumber: index + 1,
                  field
                },
                // must use raw options only since it operates over a collection.
                options
              )
            }
          }
        }

        if (window) {
          const { documents, range, unit } = window
          //  See definition: https://www.mongodb.com/docs/manual/reference/operator/aggregation/setWindowFields/#std-label-setWindowFields-range
          //  - A number to add to the value of the sortBy field for the current document.
          //  - A document is in the window if the sortBy field value is inclusively within the lower and upper boundaries.
          const boundary = documents || range

          if (!isUnbounded(window)) {
            const [begin, end] = boundary as Boundary[]

            const toBeginIndex = (currentIndex: number): number => {
              if (begin == 'current') return currentIndex
              if (begin == 'unbounded') return 0
              return Math.max(begin + currentIndex, 0)
            }

            const toEndIndex = (currentIndex: number): number => {
              if (end == 'current') return currentIndex + 1
              if (end == 'unbounded') return items.length
              return end + currentIndex + 1
            }

            const getItems = (
              current: AnyObject,
              index: number
            ): AnyObject[] => {
              // handle string boundaries or documents
              if (!!documents || boundary?.every(isString)) {
                return items.slice(toBeginIndex(index), toEndIndex(index))
              }

              // handle range with numeric boundary values
              const sortKey = Object.keys(expr.sortBy)[0]
              let lower: number
              let upper: number

              if (unit) {
                // we are dealing with datetimes
                const startDate = new Date(current[sortKey] as Date)
                const getTime = (amount: number): number => {
                  const addExpr = { startDate, unit, amount }
                  const d = $dateAdd(current, addExpr, options)
                  return d.getTime()
                }
                lower = isNumber(begin) ? getTime(begin) : -Infinity
                upper = isNumber(end) ? getTime(end) : Infinity
              } else {
                const currentValue = current[sortKey] as number
                lower = isNumber(begin) ? currentValue + begin : -Infinity
                upper = isNumber(end) ? currentValue + end : Infinity
              }

              let i = begin == 'current' ? index : 0
              const sliceEnd = end == 'current' ? index + 1 : items.length
              // look within the boundary and filter down
              const array = new Array<AnyObject>()
              while (i < sliceEnd) {
                const o = items[i++]
                const n = +(o[sortKey] as number)
                if (n >= lower && n <= upper) array.push(o)
              }
              return array
            }

            windowResultMap[field] = makeResultFunc(getItems)
          }
        }

        // default action is to utilize the entire set of items
        if (!windowResultMap[field]) {
          windowResultMap[field] = makeResultFunc(_ => items)
        }

        // invoke add fields to get the desired behaviour using a custom function.
        iterator = $addFields(
          iterator,
          {
            [field]: {
              $function: {
                body: (obj: AnyObject) => windowResultMap[field](obj),
                args: ['$$CURRENT']
              }
            }
          },
          options
        )
      }

      // add to iterator list
      iterators.push(iterator)
    }

    return concat(...iterators)
  })
}
