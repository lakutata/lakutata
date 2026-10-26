import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Autoload, Configurable} from '@lakutata/core/decorator/di'
import {AsyncTracker, type AsyncOptions, Context, definitionsOf} from '../lib/Context.js'
import type {Equation, Expression, Inequality, Value} from '../lib/Expression.js'
import {type MathDefinitions, MathScope, type SystemEquation, type SystemSolution} from '../lib/MathScope.js'
import {native, nativeCall} from '../lib/Native.js'
import {NumberTheory} from '../lib/NumberTheory.js'

/**
 * The options of a `Math` component
 */
export interface MathConfig {
    /**
     * The functions and the constants its formulas use: a body by signature (`{'f(x)': 'x^2 + 1', 'g': 9.80665}`).
     * They do not change once the component is created; `with()` adds others for a while.
     */
    definitions?: MathDefinitions
    /**
     * The significant digits of `toDecimal()` when none are given.
     * @default 32
     */
    precision?: number
    /**
     * The time limit of the asynchronous operations when none is given, in milliseconds: 0 for none.
     * @default 0
     */
    timeout?: number
    /**
     * The asynchronous operations of the component running at the same time in the threads of the addon (the others
     * wait for them): its threads, all of them, by default (the processor's cores minus one, or the environment
     * variable `LAKUTATA_MATH_THREADS`).
     */
    concurrency?: number
    /**
     * How long the destruction of the component waits for its asynchronous operations running, in milliseconds.
     * @default 10000
     */
    drainTimeout?: number
}

/**
 * The component of the formulas: it parses them (with its definitions), solves systems of equations, and gives the
 * scopes of `with()`; the expressions it gives expand, simplify, derive, solve and evaluate. Register it under a name
 * with `buildMathOptions()`, several times for several sets of definitions, or inject it unregistered with its
 * default options (`@Inject(Math)`).
 *
 * The long operations have an asynchronous version (`expandAsync()`, `solveAsync()`…) run in the threads of the addon,
 * with a time limit and a signal of cancellation; the destruction of the component waits for the ones running.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {buildMathOptions, type Equation, Math} from '@lakutata/math'
 *
 * class Pricing extends Component {
 *     @Inject('math')
 *     protected readonly math: Math
 *
 *     public async demo(): Promise<void> {
 *         console.log(this.math.expression('tax(200)').toNumber())                     //26
 *         console.log(this.math.expression('0.1 + 0.2').toString())                    //3/10
 *         const equation: Equation = this.math.equation('x^2 - 5x + 6 = 0')
 *         console.log(equation.solve('x').map(String))                                  //['2', '3']
 *         console.log(this.math.solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])[0].x.toString()) //2
 *         const expanded = await this.math.expression('(x + 1)^30').expandAsync({timeout: 1000})
 *         console.log(expanded.variables())                                             //['x']
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     components: {
 *         math: buildMathOptions({definitions: {'tax(x)': 'x * 0.13'}, precision: 50}),
 *         pricing: {class: Pricing}
 *     }
 * }))
 * ```
 */
@Autoload()
export class Math extends Component {

    /**
     * The functions and the constants its formulas use.
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Alternatives().try(DTO.String(), DTO.Number())).optional())
    protected readonly definitions?: MathDefinitions

    /**
     * The significant digits of `toDecimal()` when none are given.
     */
    @Configurable(DTO.Number().integer().min(1).max(100000).optional())
    protected readonly precision?: number

    /**
     * The time limit of the asynchronous operations when none is given, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly timeout?: number

    /**
     * The asynchronous operations running at the same time.
     */
    @Configurable(DTO.Number().integer().min(1).optional())
    protected readonly concurrency?: number

    /**
     * How long the destruction waits for the asynchronous operations running, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly drainTimeout?: number

    #scope: MathScope

    #tracker: AsyncTracker

    #ntheory: NumberTheory

    /**
     * Prepare the definitions.
     * @protected
     */
    protected async init(): Promise<void> {
        const concurrency: number = this.concurrency ?? native.versions().threads
        this.#tracker = new AsyncTracker(concurrency)
        const scope = nativeCall((addon) => addon.scope(null, definitionsOf(this.definitions ?? {})))
        const context: Context = new Context(scope, {
            precision: this.precision ?? 32,
            timeout: this.timeout ?? 0,
            concurrency: concurrency
        }, this.#tracker)
        this.#scope = new MathScope(context)
        this.#ntheory = new NumberTheory(context)
    }

    /**
     * Wait for the asynchronous operations running, at most `drainTimeout`.
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.#tracker?.drain(this.drainTimeout ?? 10000)
    }

    /**
     * The number theory of the integers (bigints): primes, factorization, modular arithmetic, integer sequences and
     * combinatorial numbers. Its asynchronous operations share the threads, the time limit and the concurrency of the
     * component. Only the component has it: a scope of `with()` does not.
     * @example
     * ```typescript
     * import {Container} from 'lakutata'
     * import {Math} from '@lakutata/math'
     *
     * const container: Container = new Container()
     * await container.setNamed('math', Math, {timeout: 5000})
     * const math: Math = await container.get<Math>('math')
     * const factors = await math.ntheory.factorAsync(2n ** 64n + 1n)   //274177n, 67280421310721n
     * await container.destroy()
     * ```
     */
    public get ntheory(): NumberTheory {
        return this.#ntheory
    }

    /**
     * Parse a formula: an expression (`x^2 - 5x + 6`), an equation (`x^2 = 4`) or an inequality (`x^2 < 4`).
     * @param text The formula.
     */
    public parse(text: string): Expression | Equation | Inequality {
        return this.#scope.parse(text)
    }

    /**
     * An expression: a formula parsed (an equation is an error), or the exact value of a number (`0.1` is `1/10`).
     * @param value The formula, or the number.
     */
    public expression(value: Value): Expression {
        return this.#scope.expression(value)
    }

    /**
     * An equation: a formula with `=` parsed.
     * @param text The formula.
     */
    public equation(text: string): Equation {
        return this.#scope.equation(text)
    }

    /**
     * A scope over the component, its definitions added: they are used by the formulas parsed by it, and replace the
     * ones of the same name. The component does not change.
     * @param definitions A body by signature: `{'h(x)': 'f(x) + 1'}`.
     */
    public with(definitions: MathDefinitions): MathScope {
        return this.#scope.with(definitions)
    }

    /**
     * The solutions of a system of linear equations: none (an empty array), or one, with the values of the variables
     * it determines (in terms of the other ones when it does not determine them all).
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables to solve for.
     */
    public solve(equations: SystemEquation[], variables: string[]): SystemSolution[] {
        return this.#scope.solve(equations, variables)
    }

    /**
     * `solve()` in the threads of the addon.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables to solve for.
     * @param options Its cancellation, its time limit.
     */
    public async solveAsync(equations: SystemEquation[], variables: string[], options?: AsyncOptions): Promise<SystemSolution[]> {
        return await this.#scope.solveAsync(equations, variables, options)
    }
}

/**
 * Build the declaration of a `Math` component, for the `components` of an application.
 * @param options Its definitions, its precision, the time limit, the concurrency and the drain of its asynchronous
 * operations.
 * @returns The component declaration.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildMathOptions} from '@lakutata/math'
 *
 * Application.run(() => ({
 *     id: 'physics.app',
 *     name: 'Physics',
 *     components: {
 *         math: buildMathOptions({definitions: {'g': 9.80665, 'fall(t)': 'g*t^2/2'}, timeout: 5000})
 *     }
 * }))
 * ```
 */
export function buildMathOptions(options: MathConfig = {}): ComponentOptions<MathConfig> {
    return {class: Math, ...options}
}
