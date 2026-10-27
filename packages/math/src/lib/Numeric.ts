import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type AsyncOptions, type Context} from './Context.js'
import {equationHandleOf, Expression, handleOf, type Value} from './Expression.js'
import {type ComplexVector} from './LinearAlgebra.js'
import {type SystemEquation} from './MathScope.js'
import {isVector, Matrix, vectorOf, type VectorValue} from './Matrix.js'
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

/**
 * The options of an integral
 */
export interface IntegrateOptions {
    /**
     * The largest estimate of the error, relative to the integral of the absolute value of the function: about 1.5e-8
     * by default (the square root of the machine epsilon, the default of SciPy's `quad`). The methods usually reach a
     * much smaller error than their estimate.
     */
    tolerance?: number
    /**
     * The points inside the interval where the function is singular or jumps: the interval is split there, so that each
     * one is an end of a piece. The extrapolation often finds such a point by itself, but giving it makes the integral
     * faster and more accurate, and its error estimate reliable: for a singularity inside the interval, the
     * extrapolation's error estimate may be too small, as in QUADPACK.
     */
    points?: readonly number[]
}

/**
 * An integral, and the estimate of its error
 */
export interface IntegralResult {
    /**
     * The value of the integral.
     */
    value: number
    /**
     * The estimate of its absolute error: from the difference between two rules (Gauss-Kronrod's and Gauss's) or from
     * the extrapolation, or the difference between two levels of a double-exponential quadrature. It is usually much
     * larger than the error.
     */
    error: number
    /**
     * Whether the estimate of the error is within the tolerance times the integral of the absolute value of the
     * function.
     */
    converged: boolean
}

/**
 * An ordinary differential equation, or a system of them, y' = f(t, y), and its initial values
 */
export interface ODEProblem {
    /**
     * The derivatives of the states, in their order: expressions (or formulas) of the time and of the states. One
     * derivative for a single state.
     */
    derivatives: Value | readonly Value[]
    /**
     * The names of the states, or the name of a single state.
     */
    states: string | readonly string[]
    /**
     * The name of the time: `t` by default.
     */
    time?: string
    /**
     * The span of the time, from its start to its end: backward where the end is before the start.
     */
    span: readonly [number, number]
    /**
     * The values of the states at the start of the span, in their order; a number for a single state.
     */
    initial: number | VectorValue
}

/**
 * The options of an ordinary differential equation
 */
export interface ODEOptions {
    /**
     * `'rk45'` (Dormand and Prince's explicit method of order 5, by default), or `'radau'` for stiff equations (the
     * implicit method Radau IIA of order 5, with the exact Jacobian of the derivatives).
     */
    method?: 'rk45' | 'radau'
    /**
     * The error allowed in a step, relative to the states: 1e-6 by default (SciPy's 1e-3 is looser). A value below 100
     * times the machine epsilon is raised to it, as SciPy does.
     */
    relativeTolerance?: number
    /**
     * The error allowed in a step for states near 0: 1e-9 by default (SciPy's 1e-6 is looser).
     */
    absoluteTolerance?: number
    /**
     * The largest step: none by default.
     */
    maxStep?: number
    /**
     * The times at which the solution is given, in the span, from its start to its end, by the continuous extensions of
     * the steps; every step by default.
     */
    points?: readonly number[]
    /**
     * The largest number of steps: 100000 by default.
     */
    maxSteps?: number
}

/**
 * The solution of an ordinary differential equation
 */
export interface ODEResult {
    /**
     * The times: of every step from the start of the span, or the points asked.
     */
    t: Float64Array
    /**
     * The states: a row for each time, a column for each state.
     */
    y: Matrix
    /**
     * The steps taken.
     */
    steps: number
    /**
     * The steps rejected (their errors too large, or their Newton iterations not converging) and taken again shorter.
     */
    rejected: number
    /**
     * The evaluations of the derivatives.
     */
    evaluations: number
    /**
     * The evaluations of the Jacobian (by `'radau'`).
     */
    jacobians: number
    /**
     * Whether the solution reached the end of the span; where it did not, it ends where it stopped.
     */
    completed: boolean
    /**
     * Why it did not reach the end of the span: the step became too small (a singularity), or more than `maxSteps`
     * steps.
     */
    message?: string
}

interface NativeODE extends Omit<ODEResult, 'y'> {
    y: Float64Array
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

//The square root of the machine epsilon, the tolerance of SciPy's quad and of Boost's quadratures
const INTEGRAL_TOLERANCE: number = globalThis.Math.sqrt(Number.EPSILON)

function odeOf(result: NativeODE): ODEResult {
    const columns: number = result.t.length ? result.y.length / result.t.length : 0
    return {...result, y: new Matrix(result.t.length, columns, result.y)}
}

function rootOf(result: NativeIterative): RootResult {
    return {root: result.solution[0], converged: result.converged, iterations: result.iterations, residual: result.residual}
}

/**
 * The numeric solutions of equations, the integrals and the differential equations, computed by the addon on the
 * expressions compiled to doubles, with their derivatives where a method needs them: the roots of a polynomial, a root
 * of a function, a solution of a system of nonlinear equations, the integral of a function, the solution of ordinary
 * differential equations. It is `MathScope.numeric`; the package exports the one of `math` as `numeric`.
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
 * math.numeric.integrate('exp(-x^2)', 'x', [-Infinity, Infinity]).value   //1.7724538509055159
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

    #ode(problem: ODEProblem, options?: ODEOptions): unknown[] {
        if (typeof problem !== 'object' || problem === null) throw new MathArgumentException('The problem is an object of the derivatives, the states, the span and the initial values')
        const derivatives: readonly Value[] = Array.isArray(problem.derivatives) ? problem.derivatives : [problem.derivatives as Value]
        const states: readonly string[] = typeof problem.states === 'string' ? [problem.states] : problem.states
        if (!Array.isArray(states) || states.some((name: unknown): boolean => typeof name !== 'string')) throw new MathArgumentException('The states are names')
        if (!Array.isArray(problem.span) || problem.span.length !== 2) throw new MathArgumentException('A span is [start, end]')
        const initial: ArrayLike<number> = typeof problem.initial === 'number' ? [problem.initial] : vectorOf(problem.initial, 'The initial values')
        if (options?.points !== undefined && !Array.isArray(options.points)) throw new MathArgumentException('The points are an array of numbers')
        return [
            derivatives.map((derivative: Value): Handle => handleOf(this.context, derivative)), states, problem.time ?? 't', problem.span[0], problem.span[1], Float64Array.from(initial),
            options?.method ?? 'rk45', options?.relativeTolerance ?? 1e-6, options?.absoluteTolerance ?? 1e-9, options?.maxStep ?? Infinity, Float64Array.from(options?.points ?? []), options?.maxSteps ?? 100000
        ]
    }

    /**
     * The solution of an ordinary differential equation, or of a system of them, y' = f(t, y), from initial values: by
     * Dormand and Prince's explicit Runge-Kutta method of order 5, its error estimated by the embedded method of order
     * 4 (as SciPy's RK45, MATLAB's ode45); or, for stiff equations (`method: 'radau'`), by the implicit Runge-Kutta
     * method Radau IIA of order 5 (as SciPy's Radau), with the exact Jacobian of the derivatives. The step is chosen
     * from the error of the last one, as SciPy's `solve_ivp` chooses it. The solution is given at every step, or at the
     * `points` asked, by the continuous extensions of the steps (of order 4 and 3). Where it stops before the end of the
     * span (a singularity makes the step too small, more than `maxSteps` steps), it gives the solution up to there with
     * `completed: false` and a `message`. Derivatives that are not real at the start throw `MathDomainException`.
     * @param problem The derivatives, the states, the time, the span, the initial values.
     * @param options The method, the tolerances, the largest step, the times to give, the largest number of steps.
     * @example
     * ```typescript
     * import {numeric} from '@lakutata/math'
     *
     * //y' = -2y, y(0) = 1: e^-2t, at the default tolerances
     * const decay = numeric.solveODE({derivatives: '-2y', states: 'y', span: [0, 1], initial: 1}, {points: [0.5, 1]})
     * console.log(decay.y.data)                               //Float64Array [0.3678795037443847, 0.13533535227865426]
     * //The oscillator x'' = -x as a system: x' = v, v' = -x
     * const spring = numeric.solveODE({derivatives: ['v', '-x'], states: ['x', 'v'], span: [0, Math.PI], initial: [1, 0]}, {relativeTolerance: 1e-10, absoluteTolerance: 1e-12})
     * console.log(spring.y.row(spring.t.length - 1))          //Float64Array [-0.9999999999620447, 2.277557266047725e-12]
     * //Stiff: Van der Pol with mu = 1000
     * const stiff = numeric.solveODE({derivatives: ['v', '1000(1 - x^2)v - x'], states: ['x', 'v'], span: [0, 3000], initial: [2, 0]}, {method: 'radau'})
     * console.log(stiff.completed, stiff.steps)               //true 1296
     * ```
     */
    public solveODE(problem: ODEProblem, options?: ODEOptions): ODEResult {
        return odeOf(this.context.run<NativeODE>('solveODE', this.#ode(problem, options)))
    }

    /**
     * `solveODE()` in the threads of the addon.
     * @param problem The derivatives, the states, the time, the span, the initial values.
     * @param options The method, the tolerances, the largest step, the times to give, the largest number of steps, the
     * cancellation, the time limit.
     */
    public async solveODEAsync(problem: ODEProblem, options?: ODEOptions & AsyncOptions): Promise<ODEResult> {
        return odeOf(await this.context.runAsync<NativeODE>('solveODE', this.#ode(problem, options), options))
    }

    #integral(integrand: Value, variable: string, interval: readonly [number, number], options?: IntegrateOptions): unknown[] {
        if (typeof variable !== 'string') throw new MathArgumentException('The variable is a name')
        if (!Array.isArray(interval) || interval.length !== 2) throw new MathArgumentException('An interval is [a, b]')
        if (options?.points !== undefined && !Array.isArray(options.points)) throw new MathArgumentException('The points are an array of numbers')
        return [handleOf(this.context, integrand), variable, interval[0], interval[1], Float64Array.from(options?.points ?? []), options?.tolerance ?? INTEGRAL_TOLERANCE]
    }

    /**
     * The integral of a function of a variable over an interval `[a, b]`, whose ends may be infinite (`-Infinity`,
     * `Infinity`); with its ends reversed (`[3, 0]`), it is negated. It is computed by QUADPACK's QAGS, as SciPy's
     * `quad` computes it: the Gauss-Kronrod rule of 21 points on intervals halved where the error is largest, the
     * sequence of the results extrapolated near a singularity (Wynn's epsilon algorithm), a half line or the real line
     * mapped onto a finite interval. Unless that reaches the roundings, a double-exponential quadrature (tanh-sinh,
     * exp-sinh, sinh-sinh) computes it too, the function rewritten in terms of its distance from an end that is not 0,
     * and the more accurate result is kept: a singularity at an end (`1/sqrt(1 - x^2)` on `[-1, 1]`) is computed to the
     * roundings. Give the points inside the interval where the function is singular or jumps in `points`; the interval
     * is also split where the function is infinite at a point where the rules evaluate it. A function that is not real
     * inside the interval throws `MathDomainException`; an integral that does not converge (it diverges, oscillates
     * without end, or doubles cannot resolve it) gives its best estimate, with `converged: false`.
     * @param integrand The function.
     * @param variable Its variable.
     * @param interval The ends of the interval.
     * @param options The tolerance, the points where the function is singular or jumps.
     * @example
     * ```typescript
     * import {numeric} from '@lakutata/math'
     *
     * console.log(numeric.integrate('x^2', 'x', [0, 3]).value)                       //9
     * console.log(numeric.integrate('1/sqrt(1 - x^2)', 'x', [-1, 1]).value)          //3.141592653589794
     * console.log(numeric.integrate('x^3*exp(-x)', 'x', [0, Infinity]).value)        //6.000000000000001
     * console.log(numeric.integrate('1/sqrt(abs(x - 1))', 'x', [0, 2], {points: [1]}).value) //4
     * console.log(numeric.integrate('sin(x)/x', 'x', [0, Infinity]).converged)       //false
     * ```
     */
    public integrate(integrand: Value, variable: string, interval: readonly [number, number], options?: IntegrateOptions): IntegralResult {
        return this.context.run<IntegralResult>('integrate', this.#integral(integrand, variable, interval, options))
    }

    /**
     * `integrate()` in the threads of the addon.
     * @param integrand The function.
     * @param variable Its variable.
     * @param interval The ends of the interval.
     * @param options The tolerance, the points where the function is singular or jumps, the cancellation, the time
     * limit.
     */
    public async integrateAsync(integrand: Value, variable: string, interval: readonly [number, number], options?: IntegrateOptions & AsyncOptions): Promise<IntegralResult> {
        return await this.context.runAsync<IntegralResult>('integrate', this.#integral(integrand, variable, interval, options), options)
    }
}
