import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import type {AsyncOptions, Context} from './Context.js'
import {Equation, Expression, expressionOf, formulaOf, handleOf, Inequality, type Value} from './Expression.js'
import {MathSyntaxException} from '../exceptions/MathSyntaxException.js'
import {type Handle, nativeCall, type NativeParsed} from './Native.js'

/**
 * One solution of a system of equations: the values of the variables it determines, by their names. When the system
 * does not determine every variable, the values are given in terms of the other ones (`{x: '-y + 3'}`).
 */
export type SystemSolution = Record<string, Expression>

/**
 * An equation of a system: an equation, a formula (`'x + y = 3'`), or an expression equal to zero
 */
export type SystemEquation = Equation | Expression | string

/**
 * The definitions of formulas: a body by signature (`{'f(x)': 'x^2 + 1', 'g': 9.80665}`)
 */
export type MathDefinitions = Record<string, string | number>

/**
 * A scope of formulas: the definitions of a component, with the ones of `with()` added. The component is one, and
 * each `with()` gives another one over it, for definitions used for a while (they do not change the component).
 * @example
 * ```typescript
 * import {Math, type MathScope} from '@lakutata/math'
 *
 * function example(math: Math): void {
 *     const scope: MathScope = math.with({'area(r)': 'pi*r^2'})
 *     console.log(scope.expression('area(2)').toString()) //4pi
 *     console.log(scope.expression('area(r)').diff('r').toString()) //2pi*r
 * }
 * ```
 */
export class MathScope {

    /**
     * A scope over a context. Made by `with()`.
     * @param context The context: its definitions, its settings.
     */
    constructor(protected readonly context: Context) {
    }

    /**
     * Parse a formula: an expression (`x^2 - 5x + 6`), an equation (`x^2 = 4`) or an inequality (`x^2 < 4`).
     * @param text The formula.
     */
    public parse(text: string): Expression | Equation | Inequality {
        if (typeof text !== 'string') throw new MathArgumentException('The formula is not a string')
        return formulaOf(this.context, text)
    }

    /**
     * An expression: a formula parsed (an equation is an error), or the exact value of a number (`0.1` is `1/10`).
     * @param value The formula, or the number.
     */
    public expression(value: Value): Expression {
        if (value instanceof Expression) return value
        if (typeof value === 'string') return expressionOf(this.context, value)
        return new Expression(this.context, handleOf(this.context, value))
    }

    /**
     * An equation: a formula with `=` parsed.
     * @param text The formula.
     */
    public equation(text: string): Equation {
        const formula: Expression | Equation | Inequality = this.parse(text)
        if (!(formula instanceof Equation)) throw new MathSyntaxException(`An equation (with =) is expected: ${text}`)
        return formula
    }

    /**
     * A scope over this one, its definitions added: they are used by the formulas parsed by it, and replace the ones
     * of the same name.
     * @param definitions A body by signature: `{'h(x)': 'f(x) + 1'}`.
     */
    public with(definitions: MathDefinitions): MathScope {
        return new MathScope(this.context.derive(definitions))
    }

    /**
     * The solutions of a system of linear equations: none (an empty array), or one, with the values of the variables
     * it determines.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables to solve for.
     */
    public solve(equations: SystemEquation[], variables: string[]): SystemSolution[] {
        return this.#solutions(this.context.run<LinearResult>('solveLinear', this.#system(equations, variables)))
    }

    /**
     * `solve()` in the threads of the addon.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables to solve for.
     * @param options Its cancellation, its time limit.
     */
    public async solveAsync(equations: SystemEquation[], variables: string[], options?: AsyncOptions): Promise<SystemSolution[]> {
        return this.#solutions(await this.context.runAsync<LinearResult>('solveLinear', this.#system(equations, variables), options))
    }

    #system(equations: SystemEquation[], variables: string[]): [Handle[], string[]] {
        if (!Array.isArray(equations) || !Array.isArray(variables)) throw new MathArgumentException('The equations and the variables are arrays')
        return [equations.map((equation: SystemEquation): Handle => {
            if (equation instanceof Equation) return equation.difference().handle
            if (typeof equation !== 'string') return handleOf(this.context, equation)
            const parsed: NativeParsed = nativeCall((native) => native.parse(this.context.scope, equation))
            if (parsed.kind === 'relation') throw new MathSyntaxException(`An equation is expected, not an inequality: ${equation}`)
            return parsed.kind === 'equation' ? new Equation(new Expression(this.context, parsed.left), new Expression(this.context, parsed.right!)).difference().handle : parsed.left
        }), variables]
    }

    #solutions(result: LinearResult): SystemSolution[] {
        if (result.kind === 'empty') return []
        const solution: SystemSolution = {}
        for (const [name, value] of Object.entries(result.values)) solution[name] = new Expression(this.context, value)
        return [solution]
    }
}

/**
 * The solution of a linear system, as the addon gives it
 */
interface LinearResult {
    kind: 'finite' | 'empty'
    values: Record<string, Handle>
}
