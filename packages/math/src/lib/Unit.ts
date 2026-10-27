import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {MathDefinitionException} from '../exceptions/MathDefinitionException.js'
import {MathException} from '../exceptions/MathException.js'
import {MathSyntaxException} from '../exceptions/MathSyntaxException.js'
import {MathUnitException} from '../exceptions/MathUnitException.js'
import {Context} from './Context.js'
import {Expression, expressionOf, handleOf, type Value} from './Expression.js'
import {nativeCall} from './Native.js'
import {CONSTANTS, DIMENSIONS, type PhysicalConstant, PREFIXES, QUANTITIES, SI, UNITS} from './UnitTable.js'

/**
 * The dimensions of a unit: the power of each base quantity (`N` is `{mass: 1, length: 1, time: -2}`, the others 0)
 */
export interface UnitDimensions {
    /**
     * The power of the mass (kg).
     */
    mass: number
    /**
     * The power of the length (m).
     */
    length: number
    /**
     * The power of the time (s).
     */
    time: number
    /**
     * The power of the electric current (A).
     */
    current: number
    /**
     * The power of the temperature (K).
     */
    temperature: number
    /**
     * The power of the luminous intensity (cd).
     */
    luminousIntensity: number
    /**
     * The power of the amount of substance (mol).
     */
    amountOfSubstance: number
    /**
     * The power of the angle (rad).
     */
    angle: number
    /**
     * The power of the quantity of information (bits).
     */
    bit: number
}

/**
 * A unit of `createMath()`: its definition, its prefixes, its other names, its offset
 */
export interface CustomUnit {
    /**
     * The definition: a formula of units (`'220 yd'`, `'1852 m/h'`), or a number written as a string (`'12'`) for a
     * unit without dimensions.
     */
    definition: string
    /**
     * The prefixes the unit takes: `'none'`, `'short'` (`k`, `m`, `u`…), `'long'` (`kilo`, `milli`…) or
     * `'binary'` (`k`, `M`… and `Ki`, `Mi`…).
     * @default 'none'
     */
    prefixes?: 'none' | 'short' | 'long' | 'binary'
    /**
     * Other names of the unit (`['knots']`).
     */
    aliases?: string[]
    /**
     * The offset of a temperature: a value in the unit is its number plus the offset, times the definition (`degC`
     * is `{definition: '1 K', offset: 273.15}`).
     * @default 0
     */
    offset?: Value
}

/**
 * The units of `createMath()`, by their names: a definition (a formula of units), or a `CustomUnit`
 */
export type CustomUnits = Record<string, string | CustomUnit>

/**
 * A value with units: a `Unit`; a formula of units (`'5 cm + 2 inch'`); a number or an expression, with their units
 * given apart (`unit(5, 'cm')`) or alone, without dimensions
 */
export type UnitValue = Unit | Value

/**
 * A factor of the units of a value: a unit, its prefix, its power (`km^2` is `{unit: 'm', prefix: 'k', power: 2}`)
 */
export interface UnitPart {
    unit: string
    prefix: string
    power: number
}

/**
 * A unit resolved: its dimensions, its value in SI units (without its prefix), its offset, its set of prefixes
 */
export interface ResolvedUnit {
    dimensions: readonly number[]
    factor: Expression
    offset: Expression
    hasOffset: boolean
    prefixes: string
}

//The names of the dimensions (LUMINOUS_INTENSITY: luminousIntensity), in the order of the table
const DIMENSION_NAMES: (keyof UnitDimensions)[] = DIMENSIONS.map((name: string): keyof UnitDimensions => name.toLowerCase().replace(/_(\w)/g, (_: string, letter: string): string => letter.toUpperCase()) as keyof UnitDimensions)

//The functions of the formulas of units, the constants they know
const FUNCTIONS: ReadonlySet<string> = new Set(['sqrt', 'sin', 'cos', 'tan', 'exp', 'log', 'ln'])
const NUMBERS: ReadonlySet<string> = new Set(['pi', 'e', 'i'])

//The sets of prefixes of the units of createMath()
const PREFIX_SETS: Readonly<Record<string, string>> = {none: 'NONE', short: 'SHORT', long: 'LONG', binary: 'BINARY_SHORT'}

const sameDimensions = (a: readonly number[], b: readonly number[]): boolean => a.every((value: number, index: number): boolean => value === b[index])
const zeroDimensions = (a: readonly number[]): boolean => a.every((value: number): boolean => value === 0)

//The members of the values with units that the formulas and the units of this module use
interface UnitInternals {
    parts(unit: Unit): readonly UnitPart[]
    isOffset(unit: Unit): boolean
    dimensions(unit: Unit): readonly number[]
    siValue(unit: Unit): Expression
}

let internals: UnitInternals

/**
 * The units a context knows: those of the table, and those of `createMath()`. A name is a unit, or a prefix and a
 * unit: the first unit of the table (then of `createMath()`) it ends with, of a set of prefixes having the rest. The
 * values of the units are found when first used, exactly.
 */
export class UnitSystem {

    readonly #custom: Map<string, {definition: string, prefixes: string, offset?: Value}> = new Map()

    readonly #order: string[] = Object.keys(UNITS)

    readonly #resolved: Map<string, ResolvedUnit> = new Map()

    readonly #resolving: Set<string> = new Set()

    readonly #prefixes: Map<string, Expression> = new Map()

    readonly #functions: Map<string, Expression> = new Map()

    readonly #factors: Map<string, Expression> = new Map()

    readonly #parsed: Map<string, readonly UnitPart[]> = new Map()

    readonly #constants: Map<string, Expression> = new Map()

    #one?: Expression

    #templates?: Context

    /**
     * The units of the table and the units of `createMath()`
     * @param units The units of `createMath()`.
     */
    constructor(units: CustomUnits = {}) {
        if (typeof units !== 'object' || units === null || Array.isArray(units)) throw new MathArgumentException('The units are an object of definitions by name')
        for (const [name, entry] of Object.entries(units)) {
            const unit: CustomUnit = typeof entry === 'string' ? {definition: entry} : entry
            if (typeof unit !== 'object' || unit === null || typeof unit.definition !== 'string') throw new MathArgumentException(`The unit ${name}: its definition is a formula of units (a string), or an object of a definition`)
            if (unit.aliases !== undefined && (!Array.isArray(unit.aliases) || unit.aliases.some((alias: unknown): boolean => typeof alias !== 'string'))) throw new MathArgumentException(`The unit ${name}: its aliases are an array of names`)
            const prefixes: string | undefined = PREFIX_SETS[unit.prefixes ?? 'none']
            if (!prefixes) throw new MathArgumentException(`The unit ${name}: its prefixes are 'none', 'short', 'long' or 'binary'`)
            for (const alias of [name, ...unit.aliases ?? []]) {
                if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) throw new MathDefinitionException(`The unit ${alias}: a name is letters, digits and underscores, beginning with a letter`)
                if (FUNCTIONS.has(alias) || NUMBERS.has(alias)) throw new MathDefinitionException(`The unit ${alias}: the name is used by the formulas of units`)
                if (this.#custom.has(alias)) throw new MathDefinitionException(`The unit ${alias} is defined twice`)
                const found: {unit: string, prefix: string} | undefined = this.find(alias)
                if (found) throw new MathDefinitionException(`The name ${alias} is already a unit${found.prefix ? ` (${found.prefix} ${found.unit})` : ''}`)
                this.#custom.set(alias, {definition: unit.definition, prefixes: prefixes, offset: unit.offset})
                this.#order.push(alias)
            }
        }
    }

    /**
     * The unit and the prefix of a name, if it is one
     * @param name
     */
    public find(name: string): {unit: string, prefix: string} | undefined {
        if (Object.hasOwn(UNITS, name) || this.#custom.has(name)) return {unit: name, prefix: ''}
        for (const unit of this.#order) {
            if (name.length > unit.length && name.endsWith(unit)) {
                const prefix: string = name.slice(0, name.length - unit.length)
                if (Object.hasOwn(PREFIXES[this.#prefixSetOf(unit)]!, prefix)) return {unit: unit, prefix: prefix}
            }
        }
        return undefined
    }

    /**
     * Check the units of `createMath()`: each definition found, of units known, without a cycle
     * @param context
     */
    public validate(context: Context): void {
        for (const name of this.#custom.keys()) this.resolve(context, name)
    }

    /**
     * A unit resolved: its dimensions, its value, its offset
     * @param context
     * @param name
     */
    public resolve(context: Context, name: string): ResolvedUnit {
        const known: ResolvedUnit | undefined = this.#resolved.get(name)
        if (known) return known
        const custom: {definition: string, prefixes: string, offset?: Value} | undefined = this.#custom.get(name)
        if (!custom && !Object.hasOwn(UNITS, name)) throw new MathUnitException(`Unknown unit "${name}": a unit of another scope`)
        const definition: string = custom ? custom.definition : UNITS[name]!.value
        if (this.#resolving.has(name)) throw new MathDefinitionException(`The unit ${name} is defined in terms of itself`)
        //The unit is being resolved until its value is found: the units of its definition are resolved meanwhile
        this.#resolving.add(name)
        try {
            const resolved: ResolvedUnit = this.#resolveDefinition(context, name, definition, custom)
            this.#resolved.set(name, resolved)
            return resolved
        } catch (error) {
            if (custom && error instanceof MathException && !(error instanceof MathDefinitionException)) throw new MathDefinitionException(`The unit ${name}: ${error.message}`)
            throw error
        } finally {
            this.#resolving.delete(name)
        }
    }

    /**
     * The factor of a prefix of a unit
     * @param context
     * @param unit
     * @param prefix
     */
    public prefixFactor(context: Context, unit: string, prefix: string): Expression {
        const set: string = this.#prefixSetOf(unit)
        const key: string = `${set}:${prefix}`
        let factor: Expression | undefined = this.#prefixes.get(key)
        if (!factor) {
            factor = expressionOf(context, PREFIXES[set]![prefix]![0])
            this.#prefixes.set(key, factor)
        }
        return factor
    }

    /**
     * The number 1
     * @param context
     */
    public one(context: Context): Expression {
        return this.#one ??= expressionOf(context, '1')
    }

    /**
     * The value in SI units of a unit with its prefix, to its power
     * @param context
     * @param part
     */
    public factor(context: Context, part: UnitPart): Expression {
        const key: string = `${part.prefix} ${part.unit} ${part.power}`
        let factor: Expression | undefined = this.#factors.get(key)
        if (!factor) {
            factor = this.prefixFactor(context, part.unit, part.prefix).mul(this.resolve(context, part.unit).factor).pow(part.power)
            this.#factors.set(key, factor)
        }
        return factor
    }

    /**
     * The units of a formula of units, as they were parsed before (at most 1000 formulas are kept)
     * @param text
     * @param parse
     */
    public parsed(text: string, parse: () => readonly UnitPart[]): readonly UnitPart[] {
        let parts: readonly UnitPart[] | undefined = this.#parsed.get(text)
        if (!parts) {
            parts = Object.freeze(parse().map((part: UnitPart): UnitPart => Object.freeze({...part})))
            if (this.#parsed.size >= 1000) this.#parsed.clear()
            this.#parsed.set(text, parts)
        }
        return parts
    }

    /**
     * The value of a physical constant, in its units
     * @param context
     * @param name
     */
    public constant(context: Context, name: PhysicalConstant): Expression {
        let value: Expression | undefined = this.#constants.get(name)
        if (!value) {
            value = expressionOf(context, CONSTANTS[name][0])
            this.#constants.set(name, value)
        }
        return value
    }

    /**
     * The prefixes of a unit, powers of 1000 (those `toBest()` chooses)
     * @param unit
     */
    public scientificPrefixes(unit: string): string[] {
        return Object.entries(PREFIXES[this.#prefixSetOf(unit)]!).filter(([, [, scientific]]: [string, readonly [string, boolean]]): boolean => scientific).map(([prefix]: [string, readonly [string, boolean]]): string => prefix)
    }

    /**
     * A function of the formulas applied to an expression, exactly (its formula parsed without the definitions)
     * @param context
     * @param name
     * @param argument
     */
    public apply(context: Context, name: string, argument: Expression): Expression {
        this.#templates ??= new Context(nativeCall((native) => native.scope(null, [])), context.settings, context.tracker, this)
        let template: Expression | undefined = this.#functions.get(name)
        if (!template) {
            template = expressionOf(this.#templates, `${name}(x)`)
            this.#functions.set(name, template)
        }
        return new Expression(context, template.substitute({x: argument}).handle)
    }

    #resolveDefinition(context: Context, name: string, definition: string, custom: {definition: string, prefixes: string, offset?: Value} | undefined): ResolvedUnit {
        const value: Unit = unitFormulaOf(context, definition)
        if (internals.isOffset(value)) throw new MathDefinitionException(`The unit ${name}: a definition cannot be a temperature with an offset (${definition})`)
        const dimensions: readonly number[] = custom || !zeroDimensions(internals.dimensions(value)) ? internals.dimensions(value) : QUANTITIES[UNITS[name]!.quantity]!
        if (!custom && !sameDimensions(dimensions, QUANTITIES[UNITS[name]!.quantity]!)) throw new MathUnitException(`The unit ${name} is not of its quantity`)
        const offset: Expression = custom ? new Expression(context, handleOf(context, custom.offset ?? 0)) : expressionOf(context, UNITS[name]!.offset)
        return {
            dimensions: dimensions,
            factor: internals.siValue(value),
            offset: offset,
            hasOffset: offset.isZero() !== true,
            prefixes: this.#prefixSetOf(name)
        }
    }

    #prefixSetOf(unit: string): string {
        return this.#custom.get(unit)?.prefixes ?? UNITS[unit]!.prefixes
    }
}

/**
 * A value with units: immutable, each operation gives a new one. Its number is exact (an `Expression`), and so are
 * the values of its units: `unit('1 inch').to('cm')` is exactly `2.54 cm`, `unit('90 deg').to('rad')` is
 * `(pi/2) rad`. Values of dimensions that differ cannot be added or converted (`MathUnitException`). A temperature with
 * an offset (`degC`, `degF`) is converted and compared, never added, multiplied or divided: convert it to `K` first.
 * @example
 * ```typescript
 * import {constant, unit} from '@lakutata/math'
 *
 * console.log(unit('5 cm + 2 inch').toString())                  //10.08 cm
 * console.log(unit('100 km/h').to('m/s').toString())             //(250/9) m / s
 * console.log(unit('100 km/h').toNumber('m/s'))                  //27.77777777777778
 * console.log(unit('20 degC').to('degF').toString())             //68 degF
 * console.log(unit('5400 s').toBest(['h', 'min', 's']).toString()) //1.5 h
 * console.log(unit('2 kg').mul(constant('speedOfLight').pow(2)).to('J').toDecimal(10)) //1.797510357e+17 J
 * ```
 */
export class Unit {

    static {
        internals = {
            parts: (unit: Unit): readonly UnitPart[] => unit.parts,
            isOffset: (unit: Unit): boolean => unit.#isOffset(),
            dimensions: (unit: Unit): readonly number[] => unit.#dimensionList(),
            siValue: (unit: Unit): Expression => unit.#siValue()
        }
    }

    #dimensions?: readonly number[]

    /**
     * A value with units. Made by `unit()`, `constant()` and by the operations.
     * @param context The context of the formulas: its definitions, its settings, its units.
     * @param magnitude The number, in the units.
     * @param parts The units: each one, its prefix and its power.
     */
    constructor(protected readonly context: Context, protected readonly magnitude: Expression, protected readonly parts: readonly UnitPart[]) {
    }

    /**
     * The number, in the units of the value (`5` of `5 cm`)
     */
    public get value(): Expression {
        //In the context of the value (its number may come from the numbers the units keep)
        return new Expression(this.context, this.magnitude.handle)
    }

    /**
     * The units, as `unit()` reads them: `cm`, `m / s^2`, `kg m^2 / (s^2 K)`; an empty string without units
     */
    public get units(): string {
        return unitsText(this.parts)
    }

    /**
     * The dimensions: the power of each base quantity
     */
    public get dimensions(): UnitDimensions {
        const dimensions: readonly number[] = this.#dimensionList()
        return Object.fromEntries(DIMENSION_NAMES.map((name: keyof UnitDimensions, index: number): [string, number] => [name, dimensions[index]!])) as unknown as UnitDimensions
    }

    /**
     * Whether another value has the same dimensions (`unit('5 cm').hasDimensionsOf('inch')` is true).
     * @param other A value with units, or a formula of units.
     */
    public hasDimensionsOf(other: UnitValue): boolean {
        return sameDimensions(this.#dimensionList(), this.#unitOf(other).#dimensionList())
    }

    /**
     * The value in other units of the same dimensions: `unit('5 cm').to('inch')`, `unit('20 degC').to('K')`.
     * @param units The units: a formula of units without a number (`'m/s^2'`), or a value whose units are taken.
     */
    public to(units: string | Unit): Unit {
        const parts: readonly UnitPart[] = units instanceof Unit ? units.parts : unitPartsOf(this.context, units)
        const target: Unit = new Unit(this.context, this.context.units.one(this.context), parts)
        if (!sameDimensions(this.#dimensionList(), target.#dimensionList())) {
            throw new MathUnitException(`${this.units || 'A number'} cannot be converted to ${target.units || 'a number'}: their dimensions differ`)
        }
        let magnitude: Expression
        if (target.#isOffset()) {
            //The number of a temperature with an offset, its prefix applied to it: 273.151 K is 1 mdegC
            const part: UnitPart = parts[0]!, resolved: ResolvedUnit = target.#resolved(part)
            magnitude = this.#siValue().div(resolved.factor).sub(resolved.offset).div(this.context.units.prefixFactor(this.context, part.unit, part.prefix))
        } else {
            magnitude = this.#siValue().div(target.#factor())
        }
        return new Unit(this.context, magnitude, parts)
    }

    /**
     * The value in SI units: the SI unit of its quantity when there is one (`N`, `J`, `Pa`…); otherwise each of its
     * units in the SI unit of its quantity, or in base units (`kg`, `m`, `s`, `A`, `K`, `cd`, `mol`, `rad`, `bits`):
     * `unit('1 BTU/(lb degF)').toSI()` is in `J / (kg K)`.
     */
    public toSI(): Unit {
        const dimensions: readonly number[] = this.#dimensionList()
        if (zeroDimensions(dimensions)) return new Unit(this.context, this.#siValue(), [])
        const named = (wanted: readonly number[]): string | undefined => Object.entries(SI).find(([quantity]: [string, string]): boolean => sameDimensions(QUANTITIES[quantity]!, wanted))?.[1]
        const whole: string | undefined = named(dimensions)
        if (whole) return this.to(whole)
        let parts: UnitPart[] = []
        for (const part of this.parts) {
            const own: readonly number[] = this.#resolved(part).dimensions
            const si: readonly UnitPart[] = zeroDimensions(own) ? [] : unitPartsOf(this.context, named(own) ?? baseUnitsText(own))
            parts = mergeParts(parts, si.map((unit: UnitPart): UnitPart => ({...unit, power: unit.power * part.power})))
        }
        return this.to(new Unit(this.context, this.context.units.one(this.context), parts))
    }

    /**
     * The value in the unit that reads best: the largest one in which its number is at least 1 in absolute value, the
     * smallest one when there is none. Of the units given, or of the prefixes of its first unit that are powers of 1000
     * (`unit('5000 m').toBest()` is `5 km`). A value of 0, a value without units and a temperature with an offset are
     * given as they are.
     * @param units The units to choose from (`['h', 'min', 's']`): of the dimensions of the value.
     */
    public toBest(units?: string[]): Unit {
        let candidates: (readonly UnitPart[])[]
        if (units !== undefined) {
            if (!Array.isArray(units) || units.length === 0 || units.some((text: unknown): boolean => typeof text !== 'string')) throw new MathArgumentException('The units to choose from are an array of formulas of units')
            candidates = units.map((text: string): readonly UnitPart[] => unitPartsOf(this.context, text))
        } else {
            if (this.parts.length === 0 || this.#isOffset()) return this
            const first: UnitPart = this.parts[0]!
            candidates = this.context.units.scientificPrefixes(first.unit).map((prefix: string): readonly UnitPart[] => [{...first, prefix: prefix}, ...this.parts.slice(1)])
        }
        if (this.magnitude.isZero() === true) return units === undefined ? this : this.to(new Unit(this.context, this.magnitude, candidates[0]!))
        const converted: {value: Unit, factor: Expression}[] = candidates.map((parts: readonly UnitPart[]): {value: Unit, factor: Expression} => {
            const value: Unit = this.to(new Unit(this.context, this.magnitude, parts))
            return {value: value, factor: value.#factor()}
        })
        const order = (a: Expression, b: Expression): number => {
            const comparison: -1 | 0 | 1 | undefined = a.compare(b)
            if (comparison === undefined) throw new MathArgumentException('The units are not ordered: their values are not real')
            return comparison
        }
        converted.sort((a, b): number => order(a.factor, b.factor))
        const atLeastOne = (value: Expression): boolean => {
            const above: -1 | 0 | 1 | undefined = value.compare(1), below: -1 | 0 | 1 | undefined = value.compare(-1)
            if (above === undefined || below === undefined) throw new MathArgumentException('The best unit is chosen for a real number, without variables')
            return above >= 0 || below <= 0
        }
        for (let index: number = converted.length - 1; index >= 0; index--) {
            if (atLeastOne(converted[index]!.value.magnitude)) return converted[index]!.value
        }
        return converted[0]!.value
    }

    /**
     * The value split into units, from the largest: the integer part in each unit but the last, the rest in the last
     * one (`unit('1.5 h').split(['h', 'min'])` is `1 h` and `30 min`); exact, toward 0 for a negative value.
     * @param units The units: of the dimensions of the value.
     */
    public split(units: string[]): Unit[] {
        if (!Array.isArray(units) || units.length === 0 || units.some((text: unknown): boolean => typeof text !== 'string')) throw new MathArgumentException('The units to split into are an array of formulas of units')
        this.#noOffset('split')
        const values: Unit[] = []
        let rest: Unit = this
        for (const [index, text] of units.entries()) {
            const value: Unit = rest.to(text)
            if (index === units.length - 1) {
                values.push(value)
                break
            }
            const whole: Expression = this.context.units.apply(this.context, 'trunc', value.magnitude)
            values.push(new Unit(this.context, whole, value.parts))
            rest = new Unit(this.context, value.magnitude.sub(whole), value.parts)
        }
        return values
    }

    /**
     * The sum, in the units of this value.
     * @param other A value of the same dimensions, or a formula of units.
     */
    public add(other: UnitValue): Unit {
        return this.#sum(other, false)
    }

    /**
     * The difference, in the units of this value.
     * @param other A value of the same dimensions, or a formula of units.
     */
    public sub(other: UnitValue): Unit {
        return this.#sum(other, true)
    }

    /**
     * The product: the units multiplied (a unit of the other value is converted to the unit of the same quantity in
     * this one: `unit('5 cm').mul('2 m')` is `1000 cm^2`); a number without dimensions when they cancel.
     * @param other A value with units, a number, or a formula of units.
     */
    public mul(other: UnitValue): Unit {
        return this.#product(this.#unitOf(other), 1)
    }

    /**
     * The quotient: the units divided, as for `mul()` (`unit('3 m').div('2 cm')` is `150`).
     * @param other A value with units, a number, or a formula of units.
     */
    public div(other: UnitValue): Unit {
        return this.#product(this.#unitOf(other), -1)
    }

    /**
     * The value to a power: any one without dimensions; a rational one where the powers of its dimensions stay
     * integers (`unit('4 m^2').pow('1/2')` is `2 m`).
     * @param exponent A number, an expression or a formula of `expression()`.
     */
    public pow(exponent: Value): Unit {
        //An integer: its power at once
        if (typeof exponent === 'number' && Number.isInteger(exponent) && exponent !== 1 && !this.#isOffset() && !zeroDimensions(this.#dimensionList())) {
            return new Unit(this.context, this.magnitude.pow(exponent), this.parts.map((part: UnitPart): UnitPart => ({...part, power: part.power * exponent})))
        }
        const power: Expression = new Expression(this.context, handleOf(this.context, exponent))
        if (power.equals(1)) return this
        this.#noOffset('pow')
        if (this.parts.length === 0) return new Unit(this.context, this.magnitude.pow(power), [])
        //Units whose dimensions cancel (m/cm): a number
        if (zeroDimensions(this.#dimensionList())) return new Unit(this.context, this.#siValue().pow(power), [])
        if (power.isRational() !== true) throw new MathUnitException(`A value with units is raised to a rational number only, not to ${power.toString()}`)
        const numerator: number = power.numerator().toNumber(), denominator: number = power.denominator().toNumber()
        if (denominator === 1) {
            return new Unit(this.context, this.magnitude.pow(power), this.parts.map((part: UnitPart): UnitPart => ({...part, power: part.power * numerator})))
        }
        //A root: in the base units, whose powers must stay integers
        const dimensions: number[] = this.#dimensionList().map((value: number): number => (value * numerator) / denominator)
        if (!dimensions.every(Number.isInteger)) throw new MathUnitException(`${this.units} to the power ${power.toString()}: its dimensions are not integers`)
        const base: Unit = this.#toBase()
        return new Unit(this.context, base.magnitude.pow(power), base.parts.map((part: UnitPart): UnitPart => ({...part, power: (part.power * numerator) / denominator})))
    }

    /**
     * The square root (the powers of the dimensions even).
     */
    public sqrt(): Unit {
        return this.pow('1/2')
    }

    /**
     * The opposite.
     */
    public neg(): Unit {
        return new Unit(this.context, this.magnitude.neg(), this.parts)
    }

    /**
     * The absolute value.
     */
    public abs(): Unit {
        this.#noOffset('abs')
        return new Unit(this.context, this.context.units.apply(this.context, 'abs', this.magnitude), this.parts)
    }

    /**
     * Whether another value is the same quantity: the same dimensions and the same value in SI units, exactly
     * (`unit('1 inch').equals('2.54 cm')` is true).
     * @param other A value with units, or a formula of units.
     */
    public equals(other: UnitValue): boolean {
        const value: Unit = this.#unitOf(other)
        return sameDimensions(this.#dimensionList(), value.#dimensionList()) && this.#siValue().equals(value.#siValue())
    }

    /**
     * The order of two values of the same dimensions: -1, 0 or 1; undefined when it is not known (values that are not
     * real, or with variables).
     * @param other A value of the same dimensions, or a formula of units.
     */
    public compare(other: UnitValue): -1 | 0 | 1 | undefined {
        const value: Unit = this.#unitOf(other)
        this.#sameDimensions(value, 'compared')
        return this.#siValue().compare(value.#siValue())
    }

    /**
     * The number as a JavaScript number: in the units of the value, or in other ones.
     * @param units Units to convert to first.
     */
    public toNumber(units?: string): number {
        return (units === undefined ? this : this.to(units)).magnitude.toNumber()
    }

    /**
     * The value with its number as decimals: `'0.3937007874015748031496062992126 inch'`.
     * @param digits The significant digits: the precision of the scope by default.
     */
    public toDecimal(digits?: number): string {
        const decimals: string = this.magnitude.toDecimal(digits)
        return this.parts.length ? `${decimals} ${this.units}` : decimals
    }

    /**
     * The value as `unit()` reads it: its number, as decimals when they are exact and short (`10.08 cm`), as its
     * formula in parentheses otherwise (`(50/127) inch`, `(pi/2) rad`); then its units.
     */
    public toString(): string {
        const text: string | undefined = decimalText(this.magnitude)
        if (!this.parts.length) return text ?? this.magnitude.toString()
        return `${text ?? `(${this.magnitude.toString()})`} ${this.units}`
    }

    /**
     * The text of `toString()`, for `JSON.stringify()`.
     */
    public toJSON(): string {
        return this.toString()
    }

    /**
     * The value in LaTeX: `5\,\mathrm{cm}`, `9.8\,\frac{\mathrm{m}}{\mathrm{s}^{2}}`.
     */
    public toTeX(): string {
        const decimals: string | undefined = decimalText(this.magnitude)
        const number: string = decimals === undefined ? this.magnitude.toTeX() : decimals.replace(/e([-+])(\d+)$/, (_: string, sign: string, digits: string): string => `\\times 10^{${sign === '-' ? '-' : ''}${digits}}`)
        if (!this.parts.length) return number
        const tex = (parts: UnitPart[], sign: number): string => parts.map((part: UnitPart): string => {
            const power: number = part.power * sign
            return `\\mathrm{${part.prefix === 'u' ? '\\mu ' : part.prefix}${part.unit}}${power === 1 ? '' : `^{${power}}`}`
        }).join('\\,')
        const numerator: UnitPart[] = this.parts.filter((part: UnitPart): boolean => part.power > 0), denominator: UnitPart[] = this.parts.filter((part: UnitPart): boolean => part.power < 0)
        if (!numerator.length) return `${number}\\,${tex(denominator, 1)}`
        return `${number}\\,${denominator.length ? `\\frac{${tex(numerator, 1)}}{${tex(denominator, -1)}}` : tex(numerator, 1)}`
    }

    //Whether the value is a temperature with an offset: one unit with an offset (degC), to the power 1
    #isOffset(): boolean {
        return this.parts.length === 1 && this.parts[0]!.power === 1 && this.#resolved(this.parts[0]!).hasOffset
    }

    //The dimensions, in the order of the table
    #dimensionList(): readonly number[] {
        if (!this.#dimensions) {
            const dimensions: number[] = DIMENSIONS.map((): number => 0)
            for (const part of this.parts) this.#resolved(part).dimensions.forEach((value: number, index: number): void => {
                dimensions[index]! += value * part.power
            })
            this.#dimensions = dimensions
        }
        return this.#dimensions
    }

    //The value in SI units: of a temperature with an offset, its number with its prefix, plus the offset, times the
    //value of its unit (1 mdegC is (0.001 + 273.15) K)
    #siValue(): Expression {
        if (this.#isOffset()) {
            const part: UnitPart = this.parts[0]!, resolved: ResolvedUnit = this.#resolved(part)
            return this.magnitude.mul(this.context.units.prefixFactor(this.context, part.unit, part.prefix)).add(resolved.offset).mul(resolved.factor)
        }
        return this.parts.length ? this.magnitude.mul(this.#factor()) : this.magnitude
    }

    #resolved(part: UnitPart): ResolvedUnit {
        return this.context.units.resolve(this.context, part.unit)
    }

    //The value of the units in SI units
    #factor(): Expression {
        const units: UnitSystem = this.context.units
        let factor: Expression | undefined
        for (const part of this.parts) {
            const value: Expression = units.factor(this.context, part)
            factor = factor ? factor.mul(value) : value
        }
        return factor ?? units.one(this.context)
    }

    //The value in the base units of the SI
    #toBase(): Unit {
        return this.to(baseUnitsText(this.#dimensionList()))
    }

    #unitOf(value: UnitValue): Unit {
        return unitOf(this.context, value)
    }

    #noOffset(operation: string): void {
        if (this.#isOffset()) throw new MathUnitException(`${this.units} is a temperature with an offset: ${operation}() does not take it, convert it to K first`)
    }

    #sameDimensions(other: Unit, operation: string): void {
        if (!sameDimensions(this.#dimensionList(), other.#dimensionList())) {
            throw new MathUnitException(`${this.units || 'A number'} and ${other.units || 'a number'} cannot be ${operation}: their dimensions differ`)
        }
    }

    #sum(other: UnitValue, subtract: boolean): Unit {
        const value: Unit = this.#unitOf(other)
        this.#sameDimensions(value, subtract ? 'subtracted' : 'added')
        this.#noOffset(subtract ? 'sub' : 'add')
        value.#noOffset(subtract ? 'sub' : 'add')
        const converted: Expression = value.to(new Unit(this.context, this.magnitude, this.parts)).magnitude
        return new Unit(this.context, subtract ? this.magnitude.sub(converted) : this.magnitude.add(converted), this.parts)
    }

    #product(other: Unit, sign: 1 | -1): Unit {
        this.#noOffset(sign === 1 ? 'mul' : 'div')
        other.#noOffset(sign === 1 ? 'mul' : 'div')
        const parts: UnitPart[] = this.parts.map((part: UnitPart): UnitPart => ({...part}))
        let magnitude: Expression = sign === 1 ? this.magnitude.mul(other.magnitude) : this.magnitude.div(other.magnitude)
        for (const part of other.parts) {
            const power: number = part.power * sign
            const same: UnitPart | undefined = parts.find((mine: UnitPart): boolean => mine.unit === part.unit && mine.prefix === part.prefix)
            if (same) {
                same.power += power
                continue
            }
            //A unit of a quantity of this value: converted to its unit
            const quantity: UnitPart | undefined = parts.find((mine: UnitPart): boolean => sameDimensions(this.#resolved(mine).dimensions, this.#resolved(part).dimensions))
            if (quantity) {
                const ratio: Expression = this.context.units.factor(this.context, {...part, power: 1}).div(this.context.units.factor(this.context, {...quantity, power: 1}))
                magnitude = magnitude.mul(ratio.pow(power))
                quantity.power += power
                continue
            }
            parts.push({...part, power: power})
        }
        const product: Unit = new Unit(this.context, magnitude, parts.filter((part: UnitPart): boolean => part.power !== 0))
        return zeroDimensions(product.#dimensionList()) && product.parts.length ? new Unit(this.context, product.#siValue(), []) : product
    }
}

//The base units of the SI of dimensions (kg^1 m^2 s^-2)
function baseUnitsText(dimensions: readonly number[]): string {
    return DIMENSIONS.map((name: string, index: number): string => (dimensions[index] ? `${SI[name]}^${dimensions[index]}` : '')).filter(Boolean).join(' ')
}

//The text of units: the numerator, then the denominator (in parentheses when it has several units)
function unitsText(parts: readonly UnitPart[]): string {
    const text = (part: UnitPart, power: number): string => `${part.prefix}${part.unit}${power === 1 ? '' : `^${power}`}`
    const numerator: UnitPart[] = parts.filter((part: UnitPart): boolean => part.power > 0), denominator: UnitPart[] = parts.filter((part: UnitPart): boolean => part.power < 0)
    if (!numerator.length) return denominator.map((part: UnitPart): string => text(part, part.power)).join(' ')
    const top: string = numerator.map((part: UnitPart): string => text(part, part.power)).join(' ')
    if (!denominator.length) return top
    const bottom: string = denominator.map((part: UnitPart): string => text(part, -part.power)).join(' ')
    return `${top} / ${denominator.length > 1 ? `(${bottom})` : bottom}`
}

//The exact decimals of a rational number whose denominator divides a power of 10, of at most 30 digits: 2.54, 1.5e-19
function decimalText(value: Expression): string | undefined {
    if (value.isRational() !== true) return undefined
    const numerator: bigint = BigInt(value.numerator().toString()), denominator: bigint = BigInt(value.denominator().toString())
    let rest: bigint = denominator, twos: number = 0, fives: number = 0
    while (rest % 2n === 0n) {
        rest /= 2n
        twos++
    }
    while (rest % 5n === 0n) {
        rest /= 5n
        fives++
    }
    if (rest !== 1n) return undefined
    const scale: number = Math.max(twos, fives)
    const scaled: bigint = numerator * (10n ** BigInt(scale) / denominator)
    const sign: string = scaled < 0n ? '-' : ''
    const digits: string = (scaled < 0n ? -scaled : scaled).toString()
    if (digits === '0') return '0'
    const significant: string = digits.replace(/0+$/, '')
    if (significant.length > 30) return undefined
    //The power of 10 of the first digit
    const exponent: number = digits.length - scale - 1
    if (exponent >= 21 || exponent <= -7) return `${sign}${significant[0]}${significant.length > 1 ? `.${significant.slice(1)}` : ''}e${exponent >= 0 ? '+' : '-'}${Math.abs(exponent)}`
    if (scale === 0) return `${sign}${digits}`
    const padded: string = digits.padStart(scale + 1, '0')
    const fraction: string = padded.slice(padded.length - scale).replace(/0+$/, '')
    return `${sign}${padded.slice(0, padded.length - scale)}${fraction ? `.${fraction}` : ''}`
}

/**
 * The tokens of a formula of units: numbers, names, operators
 */
interface UnitToken {
    kind: 'number' | 'name' | 'operator' | 'end'
    text: string
    position: number
}

function tokensOf(text: string): UnitToken[] {
    const tokens: UnitToken[] = []
    const pattern: RegExp = /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(\p{L}[\p{L}\p{N}_]*)|([-+*/^()])/uy
    while (pattern.lastIndex < text.length) {
        const position: number = pattern.lastIndex
        const match: RegExpExecArray | null = pattern.exec(text)
        if (!match) {
            const exception: MathSyntaxException = new MathSyntaxException(`Unexpected "${text[position]}" at ${position}: ${text}`)
            exception.position = position
            throw exception
        }
        if (match[1] !== undefined) tokens.push({kind: 'number', text: match[1], position: position})
        else if (match[2] !== undefined) tokens.push({kind: 'name', text: match[2], position: position})
        else if (match[3] !== undefined) tokens.push({kind: 'operator', text: match[3], position: position})
    }
    tokens.push({kind: 'end', text: '', position: text.length})
    return tokens
}

/**
 * The value of a formula of units: numbers (exact), units, `pi`, `e`, `i`; `+ - * / ^` and parentheses; a number
 * followed by units is a value of them (`9.8 m/s^2`); names one after the other are multiplied (`kg m`); `sqrt`, `sin`,
 * `cos`, `tan` (of angles or numbers), `exp`, `log` and `ln` (of numbers)
 */
class UnitFormula {

    readonly #tokens: UnitToken[]

    readonly #units: Map<number, boolean> = new Map()

    #index: number = 0

    constructor(protected readonly context: Context, protected readonly text: string) {
        this.#tokens = tokensOf(text)
    }

    /**
     * The value of the formula, and whether it is of units only
     */
    public parse(): {value: Unit, bare: boolean} {
        if (this.#peek().kind === 'end') this.#fail('A formula of units is expected', this.#peek())
        const result: {value: Unit, bare: boolean} = this.#sum()
        if (this.#peek().kind !== 'end') this.#fail(`Unexpected "${this.#peek().text}"`, this.#peek())
        return result
    }

    #peek(offset: number = 0): UnitToken {
        return this.#tokens[Math.min(this.#index + offset, this.#tokens.length - 1)]!
    }

    #next(): UnitToken {
        return this.#tokens[this.#index++]!
    }

    #is(text: string, offset: number = 0): boolean {
        const token: UnitToken = this.#peek(offset)
        return token.kind === 'operator' && token.text === text
    }

    #fail(message: string, token: UnitToken): never {
        const exception: MathSyntaxException = new MathSyntaxException(`${message} at ${token.position}: ${this.text}`)
        exception.position = token.position
        throw exception
    }

    #number(text: string): Unit {
        return new Unit(this.context, expressionOf(this.context, text), [])
    }

    #sum(): {value: Unit, bare: boolean} {
        let left: {value: Unit, bare: boolean} = this.#product()
        while (this.#is('+') || this.#is('-')) {
            const operator: string = this.#next().text
            const right: Unit = this.#product().value
            left = {value: operator === '+' ? left.value.add(right) : left.value.sub(right), bare: false}
        }
        return left
    }

    #product(): {value: Unit, bare: boolean} {
        let left: {value: Unit, bare: boolean} = this.#unary()
        for (;;) {
            let operator: '*' | '/'
            if (this.#is('*') || this.#is('/')) operator = this.#next().text as '*' | '/'
            else if (this.#startsPrimary()) operator = '*'
            else return left
            left = this.#combine(left, this.#unary(), operator)
        }
    }

    //A number and units: the value of them (the offset of a temperature applied); units and units: their product;
    //values: their arithmetic
    #combine(left: {value: Unit, bare: boolean}, right: {value: Unit, bare: boolean}, operator: '*' | '/'): {value: Unit, bare: boolean} {
        const invert = (parts: readonly UnitPart[]): UnitPart[] => parts.map((part: UnitPart): UnitPart => ({...part, power: -part.power}))
        if (right.bare && (left.bare || !internals.parts(left.value).length)) {
            const parts: readonly UnitPart[] = mergeParts(internals.parts(left.value), operator === '*' ? internals.parts(right.value) : invert(internals.parts(right.value)))
            return {value: new Unit(this.context, left.value.value, parts), bare: left.bare}
        }
        return {value: operator === '*' ? left.value.mul(right.value) : left.value.div(right.value), bare: false}
    }

    #startsPrimary(): boolean {
        const token: UnitToken = this.#peek()
        return token.kind === 'number' || token.kind === 'name' || this.#is('(')
    }

    //An exponent: its numbers do not take units (2^3 m is 8 m)
    #unary(exponent: boolean = false): {value: Unit, bare: boolean} {
        if (this.#is('-')) {
            this.#next()
            return {value: this.#unary(exponent).value.neg(), bare: false}
        }
        if (this.#is('+')) {
            this.#next()
            return {value: this.#unary(exponent).value, bare: false}
        }
        return this.#power(exponent)
    }

    #power(exponent: boolean): {value: Unit, bare: boolean} {
        const base: {value: Unit, bare: boolean} = this.#primary(exponent)
        if (!this.#is('^')) return base
        const token: UnitToken = this.#next()
        const power: Unit = this.#unary(true).value
        if (internals.parts(power).length) this.#fail('An exponent is a number', token)
        if (base.bare && power.value.isInteger() === true) {
            const integer: number = power.value.toNumber()
            return {value: new Unit(this.context, base.value.value, internals.parts(base.value).map((part: UnitPart): UnitPart => ({...part, power: part.power * integer}))), bare: true}
        }
        return {value: base.value.pow(power.value), bare: false}
    }

    #primary(exponent: boolean): {value: Unit, bare: boolean} {
        const token: UnitToken = this.#peek()
        if (token.kind === 'number') {
            this.#next()
            const number: Unit = this.#number(token.text)
            if (exponent || !this.#startsUnits()) return {value: number, bare: false}
            return {value: new Unit(this.context, number.value, this.#unitParts()), bare: false}
        }
        if (token.kind === 'name') {
            if (FUNCTIONS.has(token.text) && this.#is('(', 1)) {
                this.#next()
                return {value: this.#function(token, this.#parenthesized()), bare: false}
            }
            if (NUMBERS.has(token.text)) {
                this.#next()
                return {value: this.#number(token.text), bare: false}
            }
            return {value: new Unit(this.context, this.context.units.one(this.context), this.#unitParts()), bare: true}
        }
        if (this.#is('(')) return this.#parenthesized()
        return this.#fail(token.kind === 'end' ? 'The formula ends too early' : `Unexpected "${token.text}"`, token)
    }

    #parenthesized(): {value: Unit, bare: boolean} {
        this.#next()
        const value: {value: Unit, bare: boolean} = this.#sum()
        if (!this.#is(')')) this.#fail('")" is expected', this.#peek())
        this.#next()
        return value
    }

    #function(token: UnitToken, argument: {value: Unit, bare: boolean}): Unit {
        const value: Unit = argument.value
        if (token.text === 'sqrt') return value.sqrt()
        const dimensions: UnitDimensions = value.dimensions
        const angle: boolean = Object.entries(dimensions).every(([name, power]: [string, number]): boolean => power === (name === 'angle' ? 1 : 0))
        const number: boolean = zeroDimensions(internals.dimensions(value))
        if (!number && !(angle && ['sin', 'cos', 'tan'].includes(token.text))) {
            const exception: MathUnitException = new MathUnitException(`${token.text}() takes ${['sin', 'cos', 'tan'].includes(token.text) ? 'an angle or a number' : 'a number'}, not ${value.units} at ${token.position}: ${this.text}`)
            exception.position = token.position
            throw exception
        }
        return new Unit(this.context, this.context.units.apply(this.context, token.text, internals.siValue(value)), [])
    }

    //Whether units follow: a name that is not a function or a number, or parentheses of units only (parsed, then given
    //back; known by the position of the parenthesis once parsed)
    #startsUnits(offset: number = 0): boolean {
        const token: UnitToken = this.#peek(offset)
        if (token.kind === 'name') return !NUMBERS.has(token.text) && !(FUNCTIONS.has(token.text) && this.#is('(', offset + 1))
        if (!this.#is('(', offset)) return false
        const index: number = this.#index
        const start: number = index + offset
        let units: boolean | undefined = this.#units.get(start)
        if (units === undefined) {
            this.#index = start
            try {
                this.#unitFactor()
                units = true
            } catch {
                units = false
            } finally {
                this.#index = index
            }
            this.#units.set(start, units)
        }
        return units
    }

    //Units: names, powers, products and quotients of them
    #unitParts(): UnitPart[] {
        let parts: UnitPart[] = this.#unitFactor()
        for (;;) {
            if ((this.#is('*') || this.#is('/')) && this.#startsUnits(1)) {
                const operator: string = this.#next().text
                const factor: UnitPart[] = this.#unitFactor()
                parts = mergeParts(parts, operator === '*' ? factor : factor.map((part: UnitPart): UnitPart => ({...part, power: -part.power})))
            } else if (this.#startsUnits()) {
                parts = mergeParts(parts, this.#unitFactor())
            } else {
                return parts
            }
        }
    }

    #unitFactor(): UnitPart[] {
        const token: UnitToken = this.#peek()
        let parts: UnitPart[]
        if (this.#is('(')) {
            this.#next()
            parts = this.#unitParts()
            if (!this.#is(')')) this.#fail('")" is expected', this.#peek())
            this.#next()
        } else {
            if (token.kind !== 'name') this.#fail('A unit is expected', token)
            this.#next()
            const found: {unit: string, prefix: string} | undefined = this.context.units.find(token.text)
            if (!found) {
                const exception: MathUnitException = new MathUnitException(`Unknown unit "${token.text}" at ${token.position}: ${this.text}`)
                exception.position = token.position
                throw exception
            }
            parts = [{unit: found.unit, prefix: found.prefix, power: 1}]
        }
        if (this.#is('^')) {
            this.#next()
            const parenthesized: boolean = this.#is('(')
            if (parenthesized) this.#next()
            let sign: number = 1
            if (this.#is('-') || this.#is('+')) sign = this.#next().text === '-' ? -1 : 1
            const exponent: UnitToken = this.#next()
            const power: number = sign * Number(exponent.text)
            if (exponent.kind !== 'number' || !Number.isInteger(power)) this.#fail('The power of a unit is an integer', exponent)
            if (parenthesized) {
                if (!this.#is(')')) this.#fail('")" is expected', this.#peek())
                this.#next()
            }
            parts = parts.map((part: UnitPart): UnitPart => ({...part, power: part.power * power}))
        }
        return parts
    }
}

//The product of units: the powers of the same unit and prefix added, the units of power 0 removed
function mergeParts(left: readonly UnitPart[], right: readonly UnitPart[]): UnitPart[] {
    const parts: UnitPart[] = left.map((part: UnitPart): UnitPart => ({...part}))
    for (const part of right) {
        const same: UnitPart | undefined = parts.find((mine: UnitPart): boolean => mine.unit === part.unit && mine.prefix === part.prefix)
        if (same) same.power += part.power
        else parts.push({...part})
    }
    return parts.filter((part: UnitPart): boolean => part.power !== 0)
}

/**
 * The value of a formula of units
 * @param context
 * @param text
 */
export function unitFormulaOf(context: Context, text: string): Unit {
    if (typeof text !== 'string') throw new MathArgumentException('A formula of units is a string')
    return new UnitFormula(context, text).parse().value
}

/**
 * The units of a formula of units without a number, or of the number 1 (`'m/s^2'`, `'1/s'`)
 * @param context
 * @param text
 */
export function unitPartsOf(context: Context, text: string): readonly UnitPart[] {
    if (typeof text !== 'string') throw new MathArgumentException('Units are a formula of units (a string) or a value with units')
    return context.units.parsed(text, (): readonly UnitPart[] => {
        const {value, bare} = new UnitFormula(context, text).parse()
        if (!bare && (!internals.parts(value).length || !value.value.equals(1))) throw new MathArgumentException(`Units are expected, without a number: ${text}`)
        return internals.parts(value)
    })
}

/**
 * A value with units in a context: a formula of units, a value and its units, a number without units
 * @param context
 * @param value
 * @param units
 */
export function unitOf(context: Context, value: UnitValue, units?: string): Unit {
    if (units !== undefined) {
        if (value instanceof Unit) throw new MathArgumentException('The units are given with a number, not with a value with units')
        return new Unit(context, new Expression(context, handleOf(context, value)), unitPartsOf(context, units))
    }
    if (value instanceof Unit) return value
    if (typeof value === 'string') return unitFormulaOf(context, value)
    return new Unit(context, new Expression(context, handleOf(context, value)), [])
}

/**
 * A physical constant with its units, in a context
 * @param context
 * @param name
 */
export function constantOf(context: Context, name: PhysicalConstant): Unit {
    if (typeof name !== 'string' || !Object.hasOwn(CONSTANTS, name)) throw new MathArgumentException(`Not a physical constant: ${String(name)}`)
    const units: string = CONSTANTS[name][1]
    return new Unit(context, context.units.constant(context, name), units ? unitPartsOf(context, units) : [])
}
