import {describe, it} from 'node:test'
import assert from 'node:assert'
import {
    createMath,
    type Decimal,
    MathArgumentException,
    MathDivisionByZeroException,
    MathDomainException,
    MathNotSupportedException,
    type MathScope
} from '../exports/Math.js'

describe('The decimals', (): void => {
    const math: MathScope = createMath()

    it('write their shortest digits, fixed from the exponents -6 to the precision minus 1', (): void => {
        const cases: [Decimal, string][] = [
            [math.decimal('1.50'), '1.5'],
            [math.decimal(1.5).mul(2), '3'],
            [math.decimal(100), '100'],
            [math.decimal('1e25'), '10000000000000000000000000'],
            [math.decimal('1e25', {precision: 20}), '1e+25'],
            [math.decimal('1.5e25', {precision: 20}), '1.5e+25'],
            [math.decimal(1e-7), '1e-7'],
            [math.decimal(0.000001), '0.000001'],
            [math.decimal('-0.0000253'), '-0.0000253'],
            [math.decimal(1, {precision: 5}).div(3), '0.33333'],
            [math.decimal(27).cbrt(), '3'],
            [math.decimal(1000).log(10), '3'],
            [math.decimal('-0'), '0'],
            [math.decimal(12345678901234567890123456789012345n), '1.2345678901234567890123456789012e+34']
        ]
        for (const [decimal, text] of cases) assert.strictEqual(decimal.toString(), text)
        //toDecimal() writes its values so too: an exact 3 computed is 3, not 3.0000…
        assert.strictEqual(math.expression('2^(ln(3)/ln(2))').toDecimal(20), '3')
        assert.strictEqual(math.expression('10^25').toDecimal(20), '1e+25')
        assert.strictEqual(math.expression('25/1000000').toDecimal(20), '0.000025')
    })

    it('read numbers by their shortest representation, the other values exactly, and round them to their precision', (): void => {
        assert.strictEqual(math.decimal(0.1).add(0.2).toString(), '0.3')
        assert.strictEqual(math.decimal(0.1, {precision: 50}).toString(), '0.1')
        assert.strictEqual(math.decimal('2.5', {precision: 1}).toString(), '2')
        assert.strictEqual(math.decimal('3.5', {precision: 1}).toString(), '4')
        assert.strictEqual(math.decimal('1.23456789', {precision: 4}).toString(), '1.235')
        assert.strictEqual(math.decimal(math.expression('pi'), {precision: 30}).toString(), '3.14159265358979323846264338328')
        assert.strictEqual(math.decimal(math.decimal(2, {precision: 50}).sqrt(), {precision: 10}).toString(), '1.414213562')
        //The default precision is the component's
        assert.strictEqual(math.decimal(2).precision, 32)
        assert.strictEqual(math.decimal(2).sqrt().toString(), '1.4142135623730950488016887242097')
        for (const value of [NaN, Infinity, 'pi', ' 1', '1,5', '0x10', '']) {
            assert.throws((): unknown => math.decimal(value), MathArgumentException, String(value))
        }
        for (const precision of [0, 100001, 1.5]) {
            assert.throws((): unknown => math.decimal(1, {precision: precision}), MathArgumentException, String(precision))
        }
    })

    it('round their results to the precision of the decimal operated on, the values given read with all their digits', (): void => {
        const third: Decimal = math.decimal(1, {precision: 5}).div(3)
        assert.strictEqual(third.precision, 5)
        assert.strictEqual(third.add('0.000001234').toString(), '0.33333')
        assert.strictEqual(math.decimal(1, {precision: 40}).add(third).toString(), '1.33333')
        assert.strictEqual(math.decimal('1e20', {precision: 30}).add(1).sub('1e20').toString(), '1')
        assert.strictEqual(math.decimal('1e20', {precision: 10}).add(1).sub('1e20').toString(), '0')
        assert.strictEqual(math.decimal(2, {precision: 40}).sqrt().toString(), '1.41421356237309504880168872420969807857')
        assert.strictEqual(math.decimal(1, {precision: 50}).sin().toString(), '0.84147098480789650665250232163029899962256306079837')
    })

    it('give the halves exactly, to even, where the evaluations cannot tell them', (): void => {
        //log(8, 4) = 1.5 exactly: to 1 digit, 2 (the even one), whatever side the approximations of ln fall on
        assert.strictEqual(math.decimal(8, {precision: 1}).log(4).toString(), '2')
        assert.strictEqual(math.decimal(8, {precision: 2}).log(4).toString(), '1.5')
        assert.strictEqual(math.decimal(1.5, {precision: 2}).pow(2).toString(), '2.2')
        assert.strictEqual(math.expression('ln(8)/ln(4)').toDecimal(1), '2')
        assert.strictEqual(math.expression('2^(ln(7/2)/ln(2))').toDecimal(1), '4')
    })

    it('compute the arithmetic exactly before rounding: remainders, roundings, the text of fixed places', (): void => {
        assert.strictEqual(math.decimal(-7).mod(3).toString(), '2')
        assert.strictEqual(math.decimal(7).mod(-3).toString(), '-2')
        assert.strictEqual(math.decimal('5.5').mod('0.2').toString(), '0.1')
        assert.strictEqual(math.decimal('1e50').mod(3).toString(), '1')
        assert.strictEqual(math.decimal('1e50', {precision: 5}).mod(7).toString(), '2')
        assert.strictEqual(math.decimal(2.345).round(2).toString(), '2.35')
        assert.strictEqual(math.decimal(-2.5).round().toString(), '-3')
        assert.strictEqual(math.decimal(1250).round(-2).toString(), '1300')
        assert.strictEqual(math.decimal('1e30').round(2).toString(), '1000000000000000000000000000000')
        assert.strictEqual(math.decimal(1.5).toFixed(2), '1.50')
        assert.strictEqual(math.decimal('1.005').toFixed(2), '1.01')
        assert.strictEqual(math.decimal(-0.001).toFixed(2), '0.00')
        assert.strictEqual(math.decimal('1e25').toFixed(), '10000000000000000000000000')
        assert.strictEqual(math.decimal('9.99', {precision: 3}).ceil().toString(), '10')
        assert.strictEqual(math.decimal(-2.5).floor().toString(), '-3')
        assert.strictEqual(math.decimal(-2.5).trunc().toString(), '-2')
        assert.strictEqual(math.decimal(-8).cbrt().toString(), '-2')
        assert.strictEqual(math.decimal(-32).root(5).toString(), '-2')
        assert.strictEqual(math.decimal(-2).pow(3).toString(), '-8')
        assert.strictEqual(math.decimal(0).pow(0).toString(), '1')
    })

    it('compare and test their values', (): void => {
        assert.strictEqual(math.decimal(1).compare('0.999'), 1)
        assert.strictEqual(math.decimal('1.50').compare(1.5), 0)
        assert.strictEqual(math.decimal(-1).compare(1n), -1)
        assert.ok(math.decimal('1.50', {precision: 3}).equals(math.decimal(1.5, {precision: 40})))
        assert.ok(math.decimal('3.0').isInteger())
        assert.ok(math.decimal('1.5e25').isInteger())
        assert.ok(!math.decimal('1.5').isInteger())
        assert.ok(math.decimal('-0').isZero())
        assert.ok(math.decimal(-1e-30).isNegative() && !math.decimal(-1e-30).isPositive())
        assert.strictEqual(math.decimal('0.1', {precision: 50}).toNumber(), 0.1)
        assert.strictEqual(JSON.stringify({price: math.decimal('19.99')}), '{"price":"19.99"}')
    })

    it('are exact values of the formulas, and computed from them', (): void => {
        assert.strictEqual(math.expression(math.decimal('1.5e25').add(1)).toString(), '15000000000000000000000001')
        assert.strictEqual(math.expression(math.decimal('-1.5e-7')).toString(), '-3/20000000')
        assert.strictEqual(math.expression('x').substitute({x: math.decimal('0.1')}).toString(), '1/10')
        assert.throws((): unknown => math.decimal(math.expression('sqrt(-1)')), MathDomainException)
    })

    it('keep the digits of their values near the zeros of the functions', (): void => {
        //cos at pi/2 to 30 digits, the argument exact: pi/2 - x, of 20 correct digits
        assert.strictEqual(math.decimal('1.57079632679489661923132169164', {precision: 30}).cos().toString(), '-2.48557901415300312447089512528e-31')
        assert.strictEqual(math.decimal('3.141592653589793238462643383279502884197', {precision: 20}).sin().toString(), '-3.7356616720497115803e-20')
        assert.strictEqual(math.expression('cos(157079632679489661923132169164/10^29)').toDecimal(20), '-2.4855790141530031245e-31')
    })

    it('compute the special functions, in formulas and of decimals', (): void => {
        assert.strictEqual(math.decimal(0.5, {precision: 50}).gamma().toString(), '1.7724538509055160272981674833411451827975494561224')
        assert.strictEqual(math.decimal(1, {precision: 50}).lambertw().toString(), '0.56714329040978387299996866221035554975381578718651')
        assert.strictEqual(math.decimal(3, {precision: 30}).zeta().toString(), '1.20205690315959428539973816151')
        assert.strictEqual(math.decimal(1).digamma().toString(), '-0.5772156649015328606065120900824')
        assert.strictEqual(math.decimal(10).erfc().toString(), '2.0884875837625447570007862949578e-45')
        assert.strictEqual(math.expression('loggamma(1 + 1/10^20)').toDecimal(20), '-5.772156649015328606e-21')
        assert.strictEqual(math.expression('uppergamma(0, 1)').toDecimal(20), '0.21938393439552027368')
        assert.strictEqual(math.expression('lowergamma(1/2, 2) + uppergamma(1/2, 2) - sqrt(pi)').toDecimal(20), '0')
        assert.strictEqual(math.expression('polygamma(1, 1) - pi^2/6').toDecimal(20), '0')
        //Arguments within their error of a pole or of the branch point of W
        assert.throws((): unknown => math.expression('gamma(-2 + ln(6) - ln(2) - ln(3))').toDecimal(20), MathDivisionByZeroException)
        assert.throws((): unknown => math.expression('zeta(1 + ln(6) - ln(2) - ln(3))').toDecimal(20), MathDivisionByZeroException)
        assert.strictEqual(math.expression('lambertw(-1/e + ln(6) - ln(2) - ln(3))').toDecimal(20), '-1')
        assert.strictEqual(math.expression('zeta(0, 1/2 + ln(6) - ln(2) - ln(3))').toDecimal(20), '0')
        //uppergamma of an integer below 1 stays one (SymEngine made it lowergamma), in decimals and compiled
        assert.strictEqual(math.expression('uppergamma(0, x)').toString(), 'uppergamma(0, x)')
        assert.ok(globalThis.Math.abs(math.expression('uppergamma(0, x)').compile(['x'])(1) - 0.2193839343955203) < 1e-15)
        assert.ok(globalThis.Math.abs(math.expression('uppergamma(-5/2, x)').compile(['x'])(3) - 0.00052943283050101) < 1e-17)
        assert.ok(globalThis.Math.abs(math.expression('lowergamma(-3/2, x)').compile(['x'])(0.5) - 1.6133808257481452) < 1e-14)
        //The doubles of the numbers come from the decimals too
        assert.strictEqual(math.expression('gamma(1/3)').toNumber(), 2.6789385347077475)
        const cases: [() => unknown, new (...args: never[]) => Error][] = [
            [(): unknown => math.decimal(-2).gamma(), MathDivisionByZeroException],
            [(): unknown => math.decimal(0).loggamma(), MathDivisionByZeroException],
            [(): unknown => math.decimal(-0.5).loggamma(), MathDomainException],
            [(): unknown => math.decimal(1).zeta(), MathDivisionByZeroException],
            [(): unknown => math.decimal(-1).lambertw(), MathDomainException],
            [(): unknown => math.expression('polygamma(1/2, 3)').toDecimal(20), MathNotSupportedException]
        ]
        cases.forEach(([operate, exception]: [() => unknown, new (...args: never[]) => Error], index: number): void => {
            assert.throws(operate, exception, `case ${index}`)
        })
    })

    it('compute complex values in decimals, each part to its digits', (): void => {
        assert.deepStrictEqual(math.expression('e^(i*10^30)').toComplexDecimal(20), {re: '-0.99593119440539570239', im: '-0.09011690191213805803'})
        assert.deepStrictEqual(math.expression('(1 + i/10^25)^2 - 1').toComplexDecimal(10), {re: '-1e-50', im: '2e-25'})
        assert.deepStrictEqual(math.expression('i^i').toComplexDecimal(10), {re: '0.2078795764', im: '0'})
        assert.deepStrictEqual(math.expression('sqrt(-ln(2))').toComplexDecimal(10), {re: '0', im: '0.8325546112'})
        //An imaginary part that cannot be told from 0 is 0: on the cut, the upper side
        assert.deepStrictEqual(math.expression('ln(-2 + i*(ln(6) - ln(2) - ln(3)))').toComplexDecimal(10), {re: '0.6931471806', im: '3.141592654'})
        assert.throws((): unknown => math.expression('1/(i*(ln(6) - ln(2) - ln(3)))').toComplexDecimal(10), MathDivisionByZeroException)
        assert.throws((): unknown => math.expression('gamma(1 + i)').toComplexDecimal(10), MathNotSupportedException)
        //The numbers of complex values come from the decimals, and from doubles for the nodes the decimals have not
        assert.deepStrictEqual(math.expression('e^(i*10^30)').toComplex(), {re: -0.9959311944053957, im: -0.09011690191213806})
        const product: {re: number, im: number} = math.expression('gamma(1 + i)*e^(i*10^30)').toComplex()
        assert.ok(globalThis.Math.abs(product.re + 0.5099529376600928) < 1e-13 && globalThis.Math.abs(product.im - 0.10943973845900327) < 1e-13, JSON.stringify(product))
        assert.strictEqual(math.expression('i^i').toNumber(), 0.2078795763507619)
        assert.throws((): unknown => math.expression('1 + i/10^15').toNumber(), MathDomainException)
        assert.throws((): unknown => math.expression('1 + gamma(1 + i)/10^20').toNumber(), MathDomainException)
        //At the branch points of the inverse functions, where their slopes have no bound
        assert.deepStrictEqual(math.expression('asinh(i)').toComplexDecimal(10), {re: '0', im: '1.570796327'})
        assert.deepStrictEqual(math.expression('acosh(-1)').toComplexDecimal(10), {re: '0', im: '3.141592654'})
        assert.deepStrictEqual(math.expression('acsch(i)').toComplexDecimal(10), {re: '0', im: '-1.570796327'})
        assert.deepStrictEqual(math.expression('asech(-1)').toComplex(), {re: 0, im: globalThis.Math.PI})
        assert.strictEqual(math.expression('-2i*asinh(i)').toNumber(), globalThis.Math.PI)
        //The decimals of a real value of complex parts, from the complex decimals; of a complex value, an error
        assert.strictEqual(math.expression('e^(i*pi)').toDecimal(10), '-1')
        assert.strictEqual(math.expression('-i*asinh(i)').toDecimal(10), '1.570796327')
        assert.strictEqual(math.expression('i*acosh(1/2)').toDecimal(10), '-1.047197551')
        assert.strictEqual(math.decimal(math.expression('abs(asinh(i))'), {precision: 5}).toString(), '1.5708')
        assert.throws((): unknown => math.expression('-i*asinh(2i)').toDecimal(10), MathDomainException)
    })

    it('take the digits a value needs: an argument too large for the digits, a cancellation of large values', (): void => {
        //10^1000 sqrt(2) has its first digits after the point 1000 digits down (Python's decimal)
        assert.strictEqual(math.expression('10^1000*sqrt(2) - floor(10^1000*sqrt(2))').toDecimal(20), '0.089694633862891562883')
        assert.strictEqual(math.expression('1/sin(10^(10^4))').toDecimal(10), '-1.920145947')
        assert.strictEqual(math.expression('sin(10^(10^4))').toNumber(), -0.5207937456157552)
        //0 with 640 digits beyond, the values that cancel large or not
        assert.strictEqual(math.expression('sinh(200) - cosh(200) + exp(-200)').toDecimal(20), '0')
        assert.strictEqual(math.expression('ln(6) - ln(2) - ln(3)').toDecimal(20), '0')
        assert.deepStrictEqual(math.expression('e^(i*10^(10^4))').toComplexDecimal(10), {re: '-0.8536825373', im: '-0.5207937456'})
        //Up to 50000 digits beyond the ones asked: then MathNotSupportedException, at once
        assert.ok(globalThis.Math.abs(Number(math.decimal('1e30000', {precision: 10}).sin().toString())) <= 1)
        assert.throws((): unknown => math.decimal('1e60000', {precision: 10}).sin(), MathNotSupportedException)
        assert.throws((): unknown => math.expression('sin(10^(10^6))').toDecimal(20), MathNotSupportedException)
        assert.strictEqual(math.expression('sin(10^(10^6))').compare(0), undefined)
        assert.strictEqual(math.expression('sin(10^(10^6))').isZero(), undefined)
    })

    it('throw the exceptions of the package', (): void => {
        const cases: [() => unknown, new (...args: never[]) => Error][] = [
            [(): unknown => math.decimal(1).div(0), MathDivisionByZeroException],
            [(): unknown => math.decimal(0).div(0), MathDivisionByZeroException],
            [(): unknown => math.decimal(5.5).mod(0), MathDivisionByZeroException],
            [(): unknown => math.decimal(0).pow(-1), MathDivisionByZeroException],
            [(): unknown => math.decimal(0).ln(), MathDivisionByZeroException],
            [(): unknown => math.decimal(0).log10(), MathDivisionByZeroException],
            [(): unknown => math.decimal(5).log(1), MathDivisionByZeroException],
            [(): unknown => math.decimal(-1).sqrt(), MathDomainException],
            [(): unknown => math.decimal(-16).root(4), MathDomainException],
            [(): unknown => math.decimal(-8).pow('0.5'), MathDomainException],
            [(): unknown => math.decimal(-1).ln(), MathDomainException],
            [(): unknown => math.decimal(5).log(-2), MathDomainException],
            [(): unknown => math.decimal(2).asin(), MathDomainException],
            [(): unknown => math.decimal(0.5).acosh(), MathDomainException],
            [(): unknown => math.decimal(1).atanh(), MathDomainException],
            [(): unknown => math.decimal(0).atan2(0), MathDomainException],
            [(): unknown => math.decimal('1e19').exp(), MathNotSupportedException],
            [(): unknown => math.decimal('-1e19').exp(), MathNotSupportedException],
            [(): unknown => math.decimal('1e20').cosh(), MathNotSupportedException],
            [(): unknown => math.expression('exp(10^20)').toDecimal(20), MathNotSupportedException],
            [(): unknown => math.decimal(2).root(0), MathArgumentException],
            [(): unknown => math.decimal(2).round(0.5), MathArgumentException],
            [(): unknown => math.decimal(2).toFixed(-1), MathArgumentException],
            [(): unknown => math.decimal(2).add('two'), MathArgumentException]
        ]
        cases.forEach(([operate, exception]: [() => unknown, new (...args: never[]) => Error], index: number): void => {
            assert.throws(operate, exception, `case ${index}`)
        })
        //The functions of a large argument whose inverse is below the precision: no exponent beyond the decimals
        assert.strictEqual(math.decimal('1e20').tanh().toString(), '1')
        assert.strictEqual(math.decimal(-1000, {precision: 10}).sinh().toString(), '-9.85035557e+433')
    })
})
