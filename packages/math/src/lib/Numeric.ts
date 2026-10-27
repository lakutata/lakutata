import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type AsyncOptions, type Context} from './Context.js'
import {equationHandleOf, Expression, handleOf, type Value} from './Expression.js'
import {type ComplexVector} from './LinearAlgebra.js'
import {type SystemEquation} from './MathScope.js'
import {isVector, vectorOf, type VectorValue} from './Matrix.js'
import {type Handle} from './Native.js'

/**
 * The options of an iterative method
 */
export interface IterationOptions {
    /**
     * The size of the last step, relative to the solution, below which it stops: 1e-12 by default.
     */
    tolerance?: number
    /**
     * The largest number of iterations: 100 by default.
     */
    maxIterations?: number
}

/**
 * Where to look for a root of a function: in a bracket, or from a guess
 */
export interface FindRootOptions extends IterationOptions {
    /**
     * An interval `[a, b]` where the function changes its sign: the root is found in it (TOMS 748).
     */
    bracket?: readonly [number, number]
    /**
     * A first guess of the root, without a bracket: Newton's method from it.
     */
    guess?: number
}

/**
 * A root of a function, and how it was found
 */
export interface RootResult {
    /**
     * The root.
     */
    root: number
    /**
     * Whether the steps became smaller than the tolerance (relative to the root) before the largest number of
     * iterations; in a bracket, whether it became narrower than the tolerance times the root, or times the first
     * bracket for a root at 0.
     */
    converged: boolean
    /**
     * The number of iterations.
     */
    iterations: number
    /**
     * The absolute value of the function at the root.
     */
    residual: number
}

/**
 * A solution of a system of equations, and how it was found
 */
export interface SystemRootResult {
    /**
     * The values of the variables, in their order.
     */
    solution: Float64Array
    /**
     * Whether the steps became smaller than the tolerance before the largest number of iterations (of more equations
     * than variables, also where no step makes the residuals smaller: the point of their smallest values).
     */
    converged: boolean
    /**
     * The number of iterations.
     */
    iterations: number
    /**
     * The norm of the residuals of the equations at the solution: 0 at a solution, more at a point where the equations
     * have their smallest residuals but no solution.
     */
    residual: number
}

interface NativeIterative {
    solution: Float64Array
    converged: boolean
    iterations: number
    residual: number
}

function iterationsOf(options: IterationOptions | undefined): [number, number] {
    return [options?.tolerance ?? 1e-12, options?.maxIterations ?? 100]
}

function rootOf(result: NativeIterative): RootResult {
    return {root: result.solution[0], converged: result.converged, iterations: result.iterations, residual: result.residual}
}

/**
 * The numeric solutions of equations, computed by the addon on the expressions compiled to doubles, with their
 * derivatives where a method needs them: the roots of a polynomial, a root of a function, a solution of a system of
 * nonlinear equations. It is `MathScope.numeric`; the package exports the one of `math` as `numeric`.
 *
 * Its iterative methods stop when their steps become smaller than a tolerance, relative to the solution (as SciPy's
 * `fsolve`), or after a largest number of iterations, and say which (`converged`) with the residual at the solution: a
 * point where the residuals of a system are the smallest without being 0 stops them too. They do not throw where they
 * do not converge.
 * @example
 * ```typescript
 * import {math} from '@lakutata/math'
 *
 * math.numeric.polynomialRoots('x^3 - 6x^2 + 11x - 6')               //{re: Float64Array [1, 2, 3], im: Float64Array [0, 0, 0]}
 * math.numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root   //0.7390851332151606
 * math.numeric.solveSystem(['x^2 + y^2 = 4', 'x = y'], ['x', 'y'], [1, 1]).solution   //Float64Array [1.4142135623730951, 1.4142135623730951]
 * ```
 */
export class Numeric {

    /**
     * The numeric solutions of a scope.
     * @param context The context of the scope.
     */
    constructor(protected readonly context: Context) {
    }

    #polynomial(polynomial: Value | VectorValue, variable?: string): unknown[] {
        if (isVector(polynomial) && typeof polynomial !== 'string') return [vectorOf(polynomial as VectorValue, 'The coefficients')]
        const handle: Handle = handleOf(this.context, polynomial as Value)
        if (variable === undefined) {
            const variables: string[] = new Expression(this.context, handle).variables()
            if (variables.length !== 1) throw new MathArgumentException(variables.length === 0 ? 'The polynomial has no variable: name it' : `The polynomial has several variables (${variables.join(', ')}): name the one it is of`)
            variable = variables[0]
        }
        return [handle, variable]
    }

    /**
     * The roots of a polynomial, in the complex numbers, with their multiplicities, sorted by their real parts then
     * their imaginary ones: the eigenvalues of its companion matrix, balanced, polished by Newton's method (as NumPy's
     * `roots`). A root of multiplicity m is accurate to about the m-th root of the machine epsilon.
     * @param polynomial The polynomial, whose coefficients are numbers (possibly complex), or its coefficients from the
     * constant term up (as mathjs's `polynomialRoot`; NumPy's `roots` takes them from the highest power down).
     * @param variable Its variable: its only one by default.
     */
    public polynomialRoots(polynomial: Value | VectorValue, variable?: string): ComplexVector {
        return this.context.run<ComplexVector>('polynomialRoots', this.#polynomial(polynomial, variable))
    }

    /**
     * `polynomialRoots()` in the threads of the addon.
     * @param polynomial The polynomial, or its coefficients from the constant term up.
     * @param variable Its variable: its only one by default.
     * @param options Its cancellation, its time limit.
     */
    public async polynomialRootsAsync(polynomial: Value | VectorValue, variable?: string, options?: AsyncOptions): Promise<ComplexVector> {
        return await this.context.runAsync<ComplexVector>('polynomialRoots', this.#polynomial(polynomial, variable), options)
    }

    #root(equation: SystemEquation, variable: string, options: FindRootOptions): unknown[] {
        if (typeof variable !== 'string') throw new MathArgumentException('The variable is a name')
        if (options?.bracket !== undefined && !(Array.isArray(options.bracket) && options.bracket.length === 2)) throw new MathArgumentException('A bracket is [a, b]')
        if (options?.guess !== undefined && typeof options.guess !== 'number') throw new MathArgumentException('A guess is a number')
        return [equationHandleOf(this.context, equation), variable, options?.bracket ? [...options.bracket] : null, options?.guess ?? null, ...iterationsOf(options)]
    }

    /**
     * A root of a function of a variable (or of an equation, `cos(x) = x`): in a bracket where its sign changes, by
     * TOMS 748 (Alefeld, Potra and Shi; it keeps the root in the bracket); or from a guess, by Newton's method with the
     * derivative of the expression, its steps halved while the function grows. A bracket where the sign does not
     * change, or a function that is not real in it, throws `MathDomainException`.
     * @param equation The function (equal to 0), or the equation.
     * @param variable The variable.
     * @param options The bracket or the guess, the tolerance, the largest number of iterations.
     */
    public findRoot(equation: SystemEquation, variable: string, options: FindRootOptions): RootResult {
        return rootOf(this.context.run<NativeIterative>('findRoot', this.#root(equation, variable, options)))
    }

    /**
     * `findRoot()` in the threads of the addon.
     * @param equation The function (equal to 0), or the equation.
     * @param variable The variable.
     * @param options The bracket or the guess, the tolerance, the largest number of iterations, the cancellation, the
     * time limit.
     */
    public async findRootAsync(equation: SystemEquation, variable: string, options: FindRootOptions & AsyncOptions): Promise<RootResult> {
        return rootOf(await this.context.runAsync<NativeIterative>('findRoot', this.#root(equation, variable, options), options))
    }

    #system(equations: SystemEquation[], variables: string[], guess: VectorValue, options?: IterationOptions): unknown[] {
        if (!Array.isArray(equations) || !Array.isArray(variables)) throw new MathArgumentException('The equations and the variables are arrays')
        return [equations.map((equation: SystemEquation): Handle => equationHandleOf(this.context, equation)), variables, Float64Array.from(vectorOf(guess, 'The guess')), ...iterationsOf(options)]
    }

    /**
     * A solution of a system of equations from a guess: Newton's method with the Jacobian of the expressions and a line
     * search; where Newton's step fails (a singular Jacobian, a system of more equations than variables), the steps of
     * Levenberg and Marquardt. Of more equations than variables, it finds the point of their smallest residuals.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables.
     * @param guess The first values of the variables, in their order.
     * @param options The tolerance, the largest number of iterations.
     */
    public solveSystem(equations: SystemEquation[], variables: string[], guess: VectorValue, options?: IterationOptions): SystemRootResult {
        return this.context.run<NativeIterative>('solveSystem', this.#system(equations, variables, guess, options))
    }

    /**
     * `solveSystem()` in the threads of the addon.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables.
     * @param guess The first values of the variables, in their order.
     * @param options The tolerance, the largest number of iterations, the cancellation, the time limit.
     */
    public async solveSystemAsync(equations: SystemEquation[], variables: string[], guess: VectorValue, options?: IterationOptions & AsyncOptions): Promise<SystemRootResult> {
        return await this.context.runAsync<NativeIterative>('solveSystem', this.#system(equations, variables, guess, options), options)
    }
}
