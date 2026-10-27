import {describe, it} from 'node:test'
import assert from 'node:assert'
import {
    constant,
    createMath,
    MathArgumentException,
    MathDefinitionException,
    MathException,
    type MathScope,
    MathSyntaxException,
    MathUnitException,
    type PhysicalConstant,
    Unit,
    unit
} from '../exports/Math.js'

//The exception of a call, and the position it gives
function errorOf(call: () => unknown): MathException {
    try {
        call()
    } catch (error) {
        assert.ok(error instanceof MathException, String(error))
        return error
    }
    assert.fail('no exception')
}

describe('The units', (): void => {
    const math: MathScope = createMath()
    const text = (value: string): string => math.unit(value).toString()

    it('are values of formulas of units, or of numbers and their units, and print as unit() reads them', (): void => {
        assert.ok(math.unit('5 cm') instanceof Unit && text('5 cm') === '5 cm' && math.unit(5, 'cm').equals('5 cm'))
        assert.ok(math.unit('5 cm').value.toString() === '5' && math.unit('5 cm').units === 'cm')
        assert.strictEqual(math.unit('1/3', 'm').toString(), '(1/3) m')
        assert.strictEqual(math.unit(math.expression('x'), 'm').to('cm').toString(), '(100x) cm')
        //Units alone are of the number 1; a number alone has no units
        assert.ok(text('m/s') === '1 m / s' && text('2.5') === '2.5' && math.unit(2).units === '')
        //The units: the numerator, then the denominator; the powers of a denominator alone are negative
        assert.strictEqual(text('6.6743e-11 m^3/(kg s^2)'), '6.6743e-11 m^3 / (kg s^2)')
        assert.ok(text('5 mol^-1') === '5 mol^-1' && text('1 J/(mol K)') === '1 J / (mol K)' && text('2 kg m^2 s^-2') === '2 kg m^2 / s^2')
        //The number: exact decimals when they are short, its formula in parentheses otherwise
        assert.ok(text('1.602176634e-19 C') === '1.602176634e-19 C' && text('6.02214076e23 mol^-1') === '6.02214076e+23 mol^-1')
        assert.ok(text('0.000001 m') === '0.000001 m' && text('0.0000001 m') === '1e-7 m' && text('-40 degF') === '-40 degF')
        assert.ok(text('(2/3) m') === '(2/3) m' && text('(pi/2) rad') === '(pi/2) rad' && text('2i VA') === '(2i) VA')
        for (const formula of ['6.6743e-11 m^3/(kg s^2)', '(1/7) km/h', '(pi/180) rad', '-3.5 degC', '7 mol^-1', '2 kg m^2 s^-2', '1.5', 'log(3) m', 'exp(2) s', 'sqrt(2) N']) {
            const value: Unit = math.unit(formula)
            assert.ok(math.unit(value.toString()).equals(value) && math.unit(value.toString()).units === value.units, formula)
        }
        assert.strictEqual(JSON.stringify({speed: math.unit('3 m/s')}), '{"speed":"3 m / s"}')
        assert.strictEqual(math.unit('9.8 m/s^2').toTeX(), '9.8\\,\\frac{\\mathrm{m}}{\\mathrm{s}^{2}}')
        assert.strictEqual(math.unit('1.5e-19 C').toTeX(), '1.5\\times 10^{-19}\\,\\mathrm{C}')
        assert.strictEqual(math.unit('3 um mol^-1').toTeX(), '3\\,\\frac{\\mathrm{\\mu m}}{\\mathrm{mol}}')
        assert.strictEqual(math.unit('5 mol^-1').toTeX(), '5\\,\\mathrm{mol}^{-1}')
        assert.ok(math.unit('5 cm').toDecimal(5) === '5 cm' && math.unit('1 cm').to('inch').toDecimal(10) === '0.3937007874 inch')
    })

    it('read the formulas of units: a number with its units first, then the arithmetic', (): void => {
        assert.ok(text('5 cm + 2 inch') === '10.08 cm' && text('9.8 m/s^2') === '9.8 m / s^2' && text('6 m / 2 s') === '3 m / s')
        assert.ok(text('(5 m)^2') === '25 m^2' && text('2^3 m') === '8 m' && text('-(3 m)') === '-3 m' && text('2 (3 m)') === '6 m')
        assert.ok(text('2 * 3 m') === '6 m' && text('5 m (m (m (m)))') === '5 m^4' && text('5 ((((m))))') === '5 m')
        assert.ok(text('2 pi m') === '(2pi) m' && text('5/s') === '5 s^-1' && text('5 m^(-2)') === '5 m^-2')
        //The prefixes: of the set of each unit, a name read as the first unit it ends with
        assert.ok(math.unit('1 km').equals('1000 m') && math.unit('1 mm').equals('0.001 m') && math.unit('1 us').equals('1e-6 s'))
        assert.ok(math.unit('1 kilometer').equals('1 km') && math.unit('1 min').equals('60 s') && math.unit('1 ft').equals('0.3048 m'))
        assert.ok(math.unit('1 KiB').equals('1024 B') && math.unit('1 kB').equals('8000 b') && math.unit('1 kt').equals('1000000 kg'))
        //The functions: sqrt, sin, cos and tan of angles or numbers, exp and log of numbers
        assert.ok(text('sqrt(4 m^2)') === '2 m' && text('sin(30 deg)') === '0.5' && text('cos(pi rad)') === '-1' && text('tan(45 deg)') === '1')
        assert.ok(text('exp(0 m/m)') === '1' && text('log(10 kg / 1 kg)') === 'ln(10)' && text('exp(1)') === 'e' && text('ln(e) m') === '1 m')
        //The errors: their positions
        const unknown: MathException = errorOf(() => math.unit('5 m + 2 xyz'))
        assert.ok(unknown instanceof MathUnitException && unknown.position === 8, unknown.message)
        const syntax: MathException = errorOf(() => math.unit('5 cm +'))
        assert.ok(syntax instanceof MathSyntaxException && syntax.position === 6, syntax.message)
        assert.ok(errorOf(() => math.unit('5 cm $')) instanceof MathSyntaxException && errorOf(() => math.unit('')) instanceof MathSyntaxException)
        assert.ok(errorOf(() => math.unit('1 m^0.5')) instanceof MathSyntaxException && errorOf(() => math.unit('(1 m')) instanceof MathSyntaxException)
        const sine: MathException = errorOf(() => math.unit('2 + sin(1 m)'))
        assert.ok(sine instanceof MathUnitException && sine.position === 4, sine.message)
        assert.ok(errorOf(() => math.unit('exp(1 m)')) instanceof MathUnitException && errorOf(() => math.unit('2^(1 m)')) instanceof MathSyntaxException)
        //The names of the formulas of expression() are not units
        assert.ok(errorOf(() => math.unit('5 x')) instanceof MathUnitException)
    })

    it('convert exactly between units of the same dimensions', (): void => {
        assert.ok(math.unit('1 inch').to('cm').toString() === '2.54 cm' && math.unit('1 cm').to('inch').toString() === '(50/127) inch')
        assert.ok(math.unit('90 deg').to('rad').toString() === '(pi/2) rad' && math.unit('(pi/2) rad').to('deg').toString() === '90 deg')
        assert.ok(math.unit('100 km/h').to('m/s').toString() === '(250/9) m / s' && math.unit('100 km/h').toNumber('m/s') === 27.77777777777778)
        assert.ok(math.unit('1 kWh').to('J').toString() === '3600000 J' && math.unit('50 Hz').to('1/s').toString() === '50 s^-1')
        assert.ok(math.unit('1 hp').to('W').toDecimal(17) === '745.69987158227022 W' && math.unit('1 eV').to('J').toString() === '1.602176634e-19 J')
        assert.ok(math.unit('1 psi').to('Pa').equals('1 lbf/inch^2') && math.unit('1 acre').to('m^2').toString() === '4046.8564224 m^2')
        assert.ok(math.unit('1 m').to(math.unit('3 ft')).toString() === '(1250/381) ft')
        //The temperatures with an offset are converted with their offsets
        assert.ok(math.unit('20 degC').to('degF').toString() === '68 degF' && math.unit('-40 degF').to('degC').toString() === '-40 degC')
        assert.ok(math.unit('300 K').to('degC').toString() === '26.85 degC' && math.unit('0 degF').to('K').toString() === '(45967/180) K')
        //In compound units they are differences: no offset
        assert.strictEqual(math.unit('5 degC/m').to('K/m').toString(), '5 K / m')
        const differ: MathException = errorOf(() => math.unit('5 m').to('s'))
        assert.ok(differ instanceof MathUnitException && /dimensions differ/.test(differ.message))
        assert.ok(errorOf(() => math.unit('5 m').to('2 cm')) instanceof MathArgumentException && errorOf(() => math.unit('5').to('m')) instanceof MathUnitException)
        assert.deepStrictEqual(math.unit('1 N').dimensions, {mass: 1, length: 1, time: -2, current: 0, temperature: 0, luminousIntensity: 0, amountOfSubstance: 0, angle: 0, bit: 0})
        assert.ok(math.unit('5 cm').hasDimensionsOf('inch') && !math.unit('5 cm').hasDimensionsOf('5 s') && math.unit('1 J').hasDimensionsOf('N m'))
    })

    it('give SI units, the best units and the parts in several units', (): void => {
        assert.ok(math.unit('2 N * 3 m').toSI().toString() === '6 J' && math.unit('1 mi/h').toSI().toString() === '0.44704 m / s')
        assert.ok(math.unit('20 degC').toSI().toString() === '293.15 K' && math.unit('1 L').toSI().toString() === '0.001 m^3')
        assert.ok(math.unit('1 J/(mol K)').toSI().units === 'J / (mol K)' && math.unit('1 BTU/(lb degF)').toSI().units === 'J / (kg K)')
        assert.ok(math.unit('3 m/cm').toSI().toString() === '300' && math.unit('1 kg m/s^2').toSI().toString() === '1 N')
        assert.ok(math.unit('5000 m').toBest().toString() === '5 km' && math.unit('0.0012 m').toBest().toString() === '1.2 mm')
        assert.ok(math.unit('500 m').toBest().toString() === '500 m' && math.unit('2.5e-7 s').toBest().toString() === '250 ns')
        assert.ok(math.unit('1500000 m^2').toBest().toString() === '1.5 km^2' && math.unit('-5000 m').toBest().toString() === '-5 km')
        assert.ok(math.unit('5400 s').toBest(['h', 'min', 's']).toString() === '1.5 h' && math.unit('30 s').toBest(['h', 'min']).toString() === '0.5 min')
        //0, without units, with an offset: as it is
        assert.ok(math.unit('0 km').toBest().toString() === '0 km' && math.unit('3').toBest().toString() === '3' && math.unit('20 degC').toBest().toString() === '20 degC')
        assert.ok(errorOf(() => math.unit('5 m').toBest(['s'])) instanceof MathUnitException && errorOf(() => math.unit('5 m').toBest([])) instanceof MathArgumentException)
        assert.ok(errorOf(() => math.unit(math.expression('x'), 'm').toBest()) instanceof MathArgumentException)
        assert.deepStrictEqual(math.unit('1.5 h').split(['h', 'min']).map(String), ['1 h', '30 min'])
        assert.deepStrictEqual(math.unit('3725 s').split(['h', 'min', 's']).map(String), ['1 h', '2 min', '5 s'])
        assert.deepStrictEqual(math.unit('-1.5 h').split(['h', 'min']).map(String), ['-1 h', '-30 min'])
        assert.deepStrictEqual(math.unit('1 km').split(['mi', 'yd', 'ft']).map(String), ['0 mi', '1093 yd', '(701/381) ft'])
        assert.ok(errorOf(() => math.unit('20 degC').split(['degC'])) instanceof MathUnitException)
    })

    it('add in the units of the left value, multiply their units, and raise them to powers', (): void => {
        assert.ok(text('1 m + 50 cm') === '1.5 m' && text('50 cm + 1 m') === '150 cm' && math.unit('1 h').sub('30 min').toString() === '0.5 h')
        assert.ok(text('5 cm * 2 m') === '1000 cm^2' && text('2 N * 3 m') === '6 N m' && text('3 m / 2 cm') === '150' && text('3 m / 2 m') === '1.5')
        assert.ok(text('30 deg / 1 rad') === 'pi/6' && text('10 m / 4 s * 2 s') === '5 m')
        assert.ok(math.unit('2 m').mul(3).toString() === '6 m' && math.unit('2 m').div('4 s').toString() === '0.5 m / s' && math.unit('6 m').div(4).toString() === '1.5 m')
        assert.ok(math.unit('2 m').pow(3).toString() === '8 m^3' && math.unit('2 m').pow(-1).toString() === '0.5 m^-1' && math.unit('4 m^2').pow('1/2').toString() === '2 m')
        assert.ok(math.unit('5 m').pow(0).toString() === '1' && math.unit('5 m').pow('0').toString() === '1' && math.unit('5 m').pow(0).units === '')
        assert.ok(math.unit('1 m cm').sqrt().toString() === '0.1 m' && math.unit('9 m^2').sqrt().toString() === '3 m' && math.unit('4').pow('1/2').toString() === '2')
        //Units whose dimensions cancel: a number
        const root: Unit = math.unit('9 rad/deg').pow('1/2')
        assert.ok(root.units === '' && globalThis.Math.abs(root.toNumber() - globalThis.Math.sqrt(1620 / globalThis.Math.PI)) < 1e-12)
        assert.ok(math.unit('4 m/cm').sqrt().toString() === '20' && math.unit('2 m/cm').pow('x').toString() === '200^x')
        assert.ok(errorOf(() => math.unit('4 m^3').sqrt()) instanceof MathUnitException && errorOf(() => math.unit('2 m').pow('x')) instanceof MathUnitException)
        assert.ok(math.unit('-3 m').abs().toString() === '3 m' && math.unit('3 m').neg().toString() === '-3 m')
        assert.ok(errorOf(() => math.unit('1 m + 1 s')) instanceof MathUnitException && errorOf(() => math.unit('1 m').add(2)) instanceof MathUnitException)
        assert.ok(math.unit('1 inch').equals('2.54 cm') && !math.unit('1 inch').equals('2.54 s') && math.unit('20 degC').equals('68 degF'))
        assert.ok(math.unit('1 inch').compare('2 cm') === 1 && math.unit('1 m').compare('100 cm') === 0 && math.unit('20 degC').compare('300 K') === -1)
        assert.ok(math.unit(math.expression('x'), 'm').compare('1 m') === undefined && errorOf(() => math.unit('1 m').compare('1 s')) instanceof MathUnitException)
    })

    it('do not add, multiply or divide the temperatures with an offset', (): void => {
        for (const formula of ['10 degC + 5 degC', '10 degC + 5 K', '20 degC * 2', '2 * (20 degC)', '(20 degC) / 2', '(20 degC)^2']) {
            const exception: MathException = errorOf(() => math.unit(formula))
            assert.ok(exception instanceof MathUnitException && /convert it to K first/.test(exception.message), formula)
        }
        assert.ok(errorOf(() => math.unit('20 degC').abs()) instanceof MathUnitException && errorOf(() => math.unit('300 K').add('20 degC')) instanceof MathUnitException)
        assert.ok(math.unit('20 degC').to('K').add('5 K').to('degC').toString() === '25 degC' && math.unit('20 degC').neg().toString() === '-20 degC')
        assert.ok(math.unit('20 degC').pow(1).toString() === '20 degC' && math.unit('(1/3) degC').to('K').toString() === '(16409/60) K')
        assert.strictEqual(math.unit('2 degC/s * 3 s').toString(), '6 degC')
        //A prefix of a temperature with an offset applies to its number: 1 mdegC is 0.001 degC
        assert.ok(math.unit('1 mdegC').to('K').toString() === '273.151 K' && math.unit('273.151 K').to('mdegC').toString() === '1 mdegC')
        assert.strictEqual(math.unit('1 kdegF').to('K').toString(), '(145967/180) K')
    })

    it('give the physical constants of CODATA 2022, the exact ones exactly', (): void => {
        assert.strictEqual(constant('speedOfLight').toString(), '299792458 m / s')
        assert.ok(constant('electronMass').toString() === '9.1093837139e-31 kg' && constant('gravitationConstant').toString() === '6.6743e-11 m^3 / (kg s^2)')
        assert.ok(constant('reducedPlanckConstant').equals(constant('planckConstant').div('2 pi')))
        assert.ok(constant('gasConstant').equals(constant('avogadro').mul(constant('boltzmann'))) && constant('faraday').equals(constant('avogadro').mul(constant('elementaryCharge'))))
        assert.ok(constant('klitzing').equals(constant('planckConstant').div(constant('elementaryCharge').pow(2))))
        assert.ok(constant('fineStructure').units === '' && constant('fineStructure').toString() === '0.0072973525643')
        assert.ok(constant('coulomb').equals(constant('coulombConstant')) && constant('gravity').toString() === '9.80665 m / s^2')
        assert.ok(constant('molarMassC12').equals(constant('molarMass').mul(12)) && constant('efimovFactor').toDecimal(12) === '22.6943825954')
        assert.strictEqual(constant('boltzmann').mul('300 K').to('eV').toDecimal(6), '0.025852 eV')
        assert.strictEqual(unit('2 kg').mul(constant('speedOfLight').pow(2)).to('J').toDecimal(10), '1.797510357e+17 J')
        assert.ok(errorOf(() => constant('lightYear' as PhysicalConstant)) instanceof MathArgumentException)
    })

    it('add the units of createMath(), its scopes of with() too', (): void => {
        const scope: MathScope = createMath({
            units: {
                furlong: '220 yd',
                knot: {definition: '1852 m/h', aliases: ['knots'], prefixes: 'short'},
                dozen: '12',
                fortnight: '2 week',
                degX: {definition: '2 K', offset: 100}
            }
        })
        assert.ok(scope.unit('1 furlong').to('m').toString() === '201.168 m' && scope.unit('1 furlong + 10 knots * 1 h').to('km').toString() === '18.721168 km')
        assert.ok(scope.unit('1 kknot').equals('1000 knot') && scope.unit('3 dozen').mul(2).toSI().toString() === '72' && scope.unit('1 fortnight').to('day').toString() === '14 day')
        assert.ok(scope.unit('0 degX').to('K').toString() === '200 K' && scope.unit('300 K').to('degX').toString() === '50 degX')
        assert.ok(scope.with({'f(x)': 'x^2'}).unit('1 furlong').equals('201.168 m') && errorOf(() => math.unit('1 furlong')) instanceof MathUnitException)
        //The numbers of the values are of their scopes, its definitions with them
        assert.ok(scope.with({'f(x)': 'x^2'}).unit('m/s').value.add('f(3)').toString() === '10' && scope.with({'g': 2}).unit('furlong').mul(3).value.mul('g').toString() === '6')
        const definition = (units: Record<string, unknown>): MathException => errorOf(() => createMath({units: units as never}))
        assert.ok(/The name km is already a unit \(k m\)/.test(definition({km: '1000 m'}).message) && definition({kt: '1 m'}) instanceof MathDefinitionException)
        assert.ok(/defined in terms of itself/.test(definition({a1: '2 b1', b1: '3 a1'}).message) && definition({sqrt: '1 m'}) instanceof MathDefinitionException)
        assert.ok(/Unknown unit "zzz"/.test(definition({a1: '2 zzz'}).message) && definition({a1: '2 zzz'}) instanceof MathDefinitionException)
        assert.ok(definition({'2a': '1 m'}) instanceof MathDefinitionException && definition({a1: '1 m', b1: {definition: '1 m', aliases: ['a1']}}) instanceof MathDefinitionException)
        assert.ok(definition({a1: '20 degC'}) instanceof MathDefinitionException && definition({a1: '1 m +'}) instanceof MathDefinitionException)
        assert.ok(definition({a1: 5}) instanceof MathArgumentException && definition({a1: {definition: '1 m', prefixes: 'all'}}) instanceof MathArgumentException)
    })
})
