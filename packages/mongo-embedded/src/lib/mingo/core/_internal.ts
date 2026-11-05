import {
  AccumulatorOperator,
  ExpressionOperator,
  Operator,
  PipelineOperator,
  ProjectionOperator,
  QueryOperator,
  WindowOperator
} from '../operators/typings.js'
import type { UpdateParams } from '../operators/update/_internal.js'
import type {
  Any,
  AnyObject,
  ArrayOrObject,
  Callback,
  Options
} from '../types.js'
import type { UpdateConfig } from '../updater.js'
import {
  assert,
  has,
  isArray,
  isNil,
  isObject,
  isOperator,
  isString,
  resolve
} from '../util/index.js'

export type OperatorName = `$${string}`
export type AccumulatorOps = Record<OperatorName, AccumulatorOperator>
export type ExpressionOps = Record<OperatorName, ExpressionOperator>
export type ProjectionOps = Record<OperatorName, ProjectionOperator>
export type QueryOps = Record<OperatorName, QueryOperator>
export type PipelineOps = Record<OperatorName, PipelineOperator>
export type WindowOps = Record<OperatorName, WindowOperator>

/**
 * Enum representing the processing modes for handling input and output documents.
 * This determines whether cloning is applied to maintain immutability or ensure
 * distinct object references.
 */
export enum ProcessingMode {
  /** Do not clone inputs or outputs. Resulting documents may share references. This is the default mode. */
  CLONE_OFF = 0,
  /** Clone input documents to maintain immutability of the original input. */
  CLONE_INPUT = 1,
  /** Clone output documents to ensure distinct objects without shared references. */
  CLONE_OUTPUT = 2,
  /** Clone both input and output documents. Combines `CLONE_INPUT` and `CLONE_OUTPUT`.*/
  CLONE_ALL = CLONE_INPUT | CLONE_OUTPUT
}

interface Locals {
  /** Reference to the root object when processing subgraphs of the object. */
  root?: Any
  /** The groupId computed for a group of documents. */
  groupId?: Any
  /** Local user-defind variables. */
  variables?: AnyObject
  /** The current timestamp */
  readonly timestamp?: number
  /** Depth of field selector in Query condition. */
  readonly depth?: number
  /** Query condition */
  readonly condition?: AnyObject
  /** compiled information about update selectors */
  readonly updateParams?: UpdateParams
  /** update configuration */
  readonly updateConfig?: UpdateConfig
}

export class ComputeOptions implements Options {
  #locals: Locals

  private constructor(
    readonly options: Options,
    locals?: Locals
  ) {
    this.#locals = locals ? { ...locals } : {}
  }

  /**
   * Initializes a new instance of the `ComputeOptions` class with the provided options.
   *
   * @param options - A partial set of options to configure the `ComputeOptions` instance.
   *                  If an instance of `ComputeOptions` is provided, its internal options and locals are used.
   * @returns A new `ComputeOptions` instance configured with the provided options and root.
   */
  static init(options: Partial<Options>): ComputeOptions {
    return options instanceof ComputeOptions
      ? new ComputeOptions(options.options, options.#locals)
      : new ComputeOptions({
          idKey: '_id',
          scriptEnabled: true,
          useStrictMode: true,
          failOnError: true,
          processingMode: ProcessingMode.CLONE_OFF,
          ...options,
          context: options?.context
            ? Context.from(options?.context)
            : Context.init()
        })
  }

  update(locals?: Omit<Locals, 'now'>): ComputeOptions {
    Object.assign(this.#locals, locals, {
      // DO NOT override timestamp
      timestamp: this.#locals.timestamp,
      // merge variables.
      variables: { ...this.#locals?.variables, ...locals?.variables }
    })
    return this
  }

  get local() {
    return this.#locals
  }
  get now() {
    // defer setting the current time until accessed.`
    let timestamp = this.#locals.timestamp ?? 0
    if (!timestamp) {
      timestamp = Date.now()
      Object.assign(this.#locals, { timestamp })
    }
    return new Date(timestamp)
  }
  get idKey() {
    return this.options.idKey
  }
  get collation() {
    return this.options?.collation
  }
  get processingMode() {
    return this.options?.processingMode
  }
  get useStrictMode() {
    return this.options?.useStrictMode
  }
  get scriptEnabled() {
    return this.options?.scriptEnabled
  }
  get failOnError() {
    return this.options?.failOnError
  }
  get collectionResolver() {
    return this.options?.collectionResolver
  }
  get jsonSchemaValidator() {
    return this.options?.jsonSchemaValidator
  }
  get variables() {
    return this.options?.variables
  }
  get context() {
    return this.options?.context
  }
}

/**
 * The different groups of operators
 */
export enum OpType {
  ACCUMULATOR = 'accumulator',
  EXPRESSION = 'expression',
  PIPELINE = 'pipeline',
  PROJECTION = 'projection',
  QUERY = 'query',
  WINDOW = 'window'
}

/**
 * The `Context` class is a utility for managing and organizing operators of various types.
 * It provides methods to initialize, merge, and retrieve operators, as well as add specific
 * types of operators to the context.
 */
export class Context {
  #operators: Record<string, Record<string, Callback>>

  private constructor() {
    this.#operators = {
      [OpType.ACCUMULATOR]: {},
      [OpType.EXPRESSION]: {},
      [OpType.PIPELINE]: {},
      [OpType.PROJECTION]: {},
      [OpType.QUERY]: {},
      [OpType.WINDOW]: {}
    }
  }

  static init(
    ops: {
      accumulator?: AccumulatorOps
      expression?: ExpressionOps
      pipeline?: PipelineOps
      projection?: ProjectionOps
      query?: QueryOps
      window?: WindowOps
    } = {}
  ): Context {
    const ctx = new Context()
    // ensure all operator types are initialized
    for (const type of Object.keys(ops) as OpType[]) {
      // direct assignment since operators are empty at init time
      ctx.#operators[type] = { ...ops[type] } as Record<string, Callback>
    }
    return ctx
  }

  /** Returns a new context with the operators from the provided contexts merged left to right. */
  static from(...ctx: Context[]): Context {
    if (ctx.length === 1) return Context.init(ctx[0].#operators)

    const newCtx = new Context()
    for (const context of ctx) {
      for (const type of Object.values(OpType)) {
        newCtx.addOps(type, context.#operators[type])
      }
    }
    return newCtx
  }

  private addOps(
    type: OpType,
    operators: Record<OperatorName, Operator>
  ): Context {
    this.#operators[type] = Object.assign({}, operators, this.#operators[type])
    return this
  }

  getOperator(type: OpType, name: string): Callback | null {
    return this.#operators[type][name] ?? null
  }

  addAccumulatorOps(ops: AccumulatorOps) {
    return this.addOps(OpType.ACCUMULATOR, ops)
  }

  addExpressionOps(ops: ExpressionOps) {
    return this.addOps(OpType.EXPRESSION, ops)
  }

  addQueryOps(ops: QueryOps) {
    return this.addOps(OpType.QUERY, ops)
  }

  addPipelineOps(ops: PipelineOps) {
    return this.addOps(OpType.PIPELINE, ops)
  }

  addProjectionOps(ops: ProjectionOps) {
    return this.addOps(OpType.PROJECTION, ops)
  }

  addWindowOps(ops: WindowOps) {
    return this.addOps(OpType.WINDOW, ops)
  }
}

/**
 * Computes the value of the expression on the object for the given operator.
 * @deprecated use {@link evalExpr}
 */
export function computeValue(
  obj: Any,
  expr: Any,
  operator: string,
  options: Options
): Any {
  return evalExpr(obj, { [operator]: expr }, options)
}

/**
 * Evaluates an expression with the given document context.
 * @param obj The document or value to use as data context.
 * @param expr The expression to evaluate.
 * @param options Options
 * @returns Result of evaluation.
 */
export function evalExpr(obj: Any, expr: Any, options: Options): Any {
  // only intialize compute opts when necessary.
  const copts =
    !(options instanceof ComputeOptions) || isNil(options.local.root)
      ? ComputeOptions.init(options).update({ root: obj })
      : options

  return computeExpression(obj, expr, copts)
}

const SYSTEM_VARS = new Set(['$$ROOT', '$$CURRENT', '$$REMOVE', '$$NOW'])

/** Computes the value of the expr given for the object. */
function computeExpression(obj: Any, expr: Any, options: ComputeOptions): Any {
  // if expr is a string and begins with "$$", then we have a variable.
  //  this can be one of; redact variable, system variable, user-defined variable.
  //  we check and process them in that order.
  //
  // if expr begins only a single "$", then it is a path to a field on the object.
  if (isString(expr) && expr.length > 0 && expr[0] === '$') {
    // we return redact variables as literals
    if (expr === '$$KEEP' || expr === '$$PRUNE' || expr === '$$DESCEND')
      return expr

    // default to root for resolving path.
    let ctx = options.local.root

    // handle selectors with explicit prefix
    const dot = expr.indexOf('.')
    const prefix = dot === -1 ? expr : expr.substring(0, dot)
    if (SYSTEM_VARS.has(prefix)) {
      // set 'root' only the first time it is required to be used for all subsequent calls
      // if it already available on the options, it will be used
      switch (prefix) {
        case '$$ROOT':
          break
        case '$$CURRENT':
          ctx = obj
          break
        case '$$REMOVE':
          ctx = undefined
          break
        case '$$NOW':
          ctx = new Date(options.now)
          break
      }
      expr = dot === -1 ? '' : expr.substring(dot + 1)
    } else if (prefix.length >= 2 && prefix[1] === '$') {
      // handle user-defined variables
      ctx = Object.assign(
        {},
        // global vars
        options.variables,
        // current item is added before local variables because the binding may be changed.
        { this: obj },
        // local vars
        options?.local?.variables
      )
      // the variable name
      const name = prefix.substring(2)
      assert(has(ctx as AnyObject, name), `Use of undefined variable: ${name}`)
      expr = expr.substring(2)
    } else {
      // 'expr' is a path to a field on the object.
      expr = expr.substring(1)
    }

    return expr === '' ? ctx : resolve(ctx as ArrayOrObject, expr as string)
  }

  // check and return value if already in a resolved state
  if (isArray(expr)) {
    const result = new Array(expr.length)
    for (let i = 0; i < expr.length; i++) {
      result[i] = computeExpression(obj, expr[i], options)
    }
    return result
  }

  if (isObject(expr)) {
    const keys = Object.keys(expr)
    if (isOperator(keys[0])) {
      assert(keys.length === 1, 'Expression must contain a single operator.')
      return computeOperator(obj, expr[keys[0]], keys[0], options)
    }

    const result: AnyObject = {}
    for (let i = 0; i < keys.length; i++) {
      result[keys[i]] = computeExpression(obj, expr[keys[i]], options)
    }
    return result
  }

  return expr
}

function computeOperator(
  obj: Any,
  expr: Any,
  operator: string,
  options: ComputeOptions
): Any {
  const context = options.context
  // if the field of the object is a valid operator
  const fn = context.getOperator(OpType.EXPRESSION, operator)
  if (fn) return fn(obj, expr, options)

  // handle accumulators
  const accFn = context.getOperator(OpType.ACCUMULATOR, operator)!

  // operator was not found
  assert(!!accFn, `accumulator '${operator}' is not registered.`)

  // if object is not an array, attempt to resolve to array.
  if (!isArray(obj)) {
    obj = computeExpression(obj, expr, options)
    expr = null
  }

  assert(isArray(obj), `arguments must resolve to array for ${operator}.`)

  // accumulator must override the root accordingly. we pass the full context as is.
  return accFn(obj, expr, options)
}
