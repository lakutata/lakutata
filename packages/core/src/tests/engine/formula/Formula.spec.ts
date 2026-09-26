/**
 * Ported from formula/test/index.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Formula from '../../../lib/validation/engine/formula/index.js'
const internals = {}

describe('Formula', () => {

    it('evaluates a formula', () => {

        const functions = {
            x: (value) => value + 10
        }

        const constants = {
            Z: 100
        }

        const formula = new Formula.Parser('1 + a.b.c.2.4.x + [b] + x([y + 4] + Z)', { functions, constants })
        expect(formula.evaluate({ 'a.b.c.2.4.x': 2, b: 3, 'y + 4': 5 })).to.equal(1 + 2 + 3 + 5 + 10 + 100)
        expect(formula.evaluate({ 'a.b.c.2.4.x': '2', b: 3, 'y + 4': '5' })).to.equal('123510010')
    })

    it('evaluates a formula (custom reference handler)', () => {

        const functions = {
            x: (value) => value + 10
        }

        const constants = {
            Z: 100
        }

        const reference = function (name) {

            return (context) => context[name]
        }

        const formula = new Formula.Parser('1 + a.b.c.2.4.x + [b] + x([y + 4] + Z)', { functions, constants, reference })
        expect(formula.evaluate({ 'a.b.c.2.4.x': 2, b: 3, 'y + 4': 5 })).to.equal(1 + 2 + 3 + 5 + 10 + 100)
        expect(formula.evaluate({ 'a.b.c.2.4.x': '2', b: 3, 'y + 4': '5' })).to.equal('123510010')
    })

    describe('constructor()', () => {

        it('allows valid constant', () => {

            expect(() => new Formula.Parser('1 + x', { constants: { x: true } })).to.not.throw()
            expect(() => new Formula.Parser('1 + x', { constants: { x: 1 } })).to.not.throw()
            expect(() => new Formula.Parser('1 + x', { constants: { x: 'x' } })).to.not.throw()
            expect(() => new Formula.Parser('1 + x', { constants: { x: null } })).to.not.throw()
        })

        it('errors on invalid constant', () => {

            expect(() => new Formula.Parser('1 + x', { constants: { x: {} } })).to.throw('Formula constant x contains invalid object value type')
            expect(() => new Formula.Parser('1 + x', { constants: { x: () => null } })).to.throw('Formula constant x contains invalid function value type')
            expect(() => new Formula.Parser('1 + x', { constants: { x: undefined } })).to.throw('Formula constant x contains invalid undefined value type')
        })
    })

    describe('single', () => {

        it('identifies single literal (string)', () => {

            const formula = new Formula.Parser('"x"')
            expect(formula.single).to.equal({ type: 'value', value: 'x' })
        })

        it('identifies single literal (number)', () => {

            const formula = new Formula.Parser('123')
            expect(formula.single).to.equal({ type: 'value', value: 123 })
        })

        it('identifies single literal (constant)', () => {

            const formula = new Formula.Parser('x', { constants: { x: 'y' } })
            expect(formula.single).to.equal({ type: 'value', value: 'y' })
        })

        it('identifies single reference', () => {

            const formula = new Formula.Parser('x')
            expect(formula.single).to.equal({ type: 'reference', value: 'x' })
        })

        it('identifies non-single reference', () => {

            const formula = new Formula.Parser('-x')
            expect(formula.single).to.be.null()
        })
    })

    describe('_parse()', () => {

        it('parses multiple nested functions', () => {

            const functions = {
                x: (value) => value + 1,
                y: (value) => value + 2,
                z: (value) => value + 3,
                a: () => 9
            }

            const formula = new Formula.Parser('x(10) + y(z(30)) + z(x(40)) + a()', { functions })
            expect(formula.evaluate()).to.equal(11 + 33 + 2 + 41 + 3 + 9)
        })

        it('passes context as this to functions', () => {

            const functions = {
                x: function () {

                    return this.X
                }
            }

            const formula = new Formula.Parser('x()', { functions })
            expect(formula.evaluate({ X: 1 })).to.equal(1)
        })

        it('parses parenthesis', () => {

            const formula = new Formula.Parser('(x + 4) * (x - 5) / (x ^ 2)')
            expect(formula.evaluate({ x: 10 })).to.equal((10 + 4) * (10 - 5) / (Math.pow(10, 2)))
        })

        it('parses string literals', () => {

            const formula = new Formula.Parser('"x+3" + `y()` + \'-z\'')
            expect(formula.evaluate()).to.equal('x+3y()-z')
        })

        it('validates token', () => {

            expect(() => new Formula.Parser('[xy]', { tokenRx: /^\w+$/ })).to.not.throw()
            expect(() => new Formula.Parser('[x y]', { tokenRx: /^\w+$/ })).to.throw('Formula contains invalid reference x y')
        })

        it('errors on missing closing parenthesis', () => {

            expect(() => new Formula.Parser('(a + 2(')).to.throw('Formula missing closing parenthesis')
        })

        it('errors on invalid character', () => {

            expect(() => new Formula.Parser('x\u0000')).to.throw('Formula contains invalid token: x\u0000')
        })

        it('errors on invalid operator position', () => {

            expect(() => new Formula.Parser('x + + y')).to.throw('Formula contains an operator in invalid position')
            expect(() => new Formula.Parser('x + y +')).to.throw('Formula contains invalid trailing operator')
        })

        it('errors on invalid operator', () => {

            expect(() => new Formula.Parser('x | y')).to.throw('Formula contains an unknown operator |')
        })

        it('errors on invalid missing operator', () => {

            expect(() => new Formula.Parser('x y')).to.throw('Formula missing expected operator')
        })
    })

    describe('_subFormula', () => {

        it('parses multiple nested functions with arguments (numbers)', () => {

            const functions = {
                x: (a, b, c) => a + b + c,
                y: (a, b) => a * b,
                z: (value) => value + 3,
                a: () => 9
            }

            const formula = new Formula.Parser('x(10, (y((1 + 2), z(30)) + a()), z(x(4, 5, 6)))', { functions })
            expect(formula.evaluate()).to.equal(10 + (((1 + 2) * (30 + 3)) + 9) + (4 + 5 + 6) + 3)
        })

        it('parses multiple nested functions with arguments (strings)', () => {

            const functions = {
                x: (a, b, c) => a + b + c,
                y: (a, b) => a + b,
                z: (value) => value + 3,
                a: () => 9
            }

            const formula = new Formula.Parser('x("10", (y(("1" + "2"), z("30")) + a()), z(x("4", "5", "6")))', { functions })
            expect(formula.evaluate()).to.equal('101230394563')
        })

        it('errors on unknown function', () => {

            expect(() => new Formula.Parser('x()')).to.throw('Formula contains unknown function x')
        })

        it('errors on invalid function arguments', () => {

            expect(() => new Formula.Parser('x(y,)', { functions: { x: () => null } })).to.throw('Formula contains function x with invalid arguments y,')
        })
    })

    describe('evaluate()', () => {

        it('handles null constant', () => {

            const formula = new Formula.Parser('0 + null', { constants: { null: null } })

            expect(formula.evaluate()).to.equal(0)
        })
    })

    describe('single()', () => {

        it('calculates -', () => {

            const formula = new Formula.Parser('-x')

            expect(formula.evaluate({ x: 1 })).to.equal(-1)
            expect(formula.evaluate({ x: -1 })).to.equal(1)
            expect(formula.evaluate({ x: 0 })).to.equal(0)
        })

        it('handles --', () => {

            const formula = new Formula.Parser('10--x')

            expect(formula.evaluate({ x: 1 })).to.equal(11)
            expect(formula.evaluate({ x: -1 })).to.equal(9)
            expect(formula.evaluate({ x: 0 })).to.equal(10)
        })

        it('calculates !', () => {

            const formula = new Formula.Parser('!x')

            expect(formula.evaluate({ x: 1 })).to.equal(false)
            expect(formula.evaluate({ x: -1 })).to.equal(false)
            expect(formula.evaluate({ x: 0 })).to.equal(true)
        })
    })

    describe('calculate()', () => {

        it('calculates +', () => {

            const formula = new Formula.Parser('x+y')

            expect(formula.evaluate({ x: 1, y: 2 })).to.equal(3)
            expect(formula.evaluate({ y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1 })).to.equal(1)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(1)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal('12')
            expect(formula.evaluate({ y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1' })).to.equal('1')
            expect(formula.evaluate({ x: null, y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1', y: null })).to.equal('1')

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal('12')
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal('12')
        })

        it('calculates -', () => {

            const formula = new Formula.Parser('x-y')

            expect(formula.evaluate({ x: 1, y: 2 })).to.equal(-1)
            expect(formula.evaluate({ y: 2 })).to.equal(-2)
            expect(formula.evaluate({ x: 1 })).to.equal(1)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(-2)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(1)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(formula.evaluate({ y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1' })).to.equal(null)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(null)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates *', () => {

            const formula = new Formula.Parser('x*y')

            expect(formula.evaluate({ x: 20, y: 10 })).to.equal(200)
            expect(formula.evaluate({ y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1 })).to.equal(0)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(0)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(formula.evaluate({ y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1' })).to.equal(null)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(null)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates /', () => {

            const formula = new Formula.Parser('x/y')

            expect(formula.evaluate({ x: 20, y: 10 })).to.equal(2)
            expect(formula.evaluate({ y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1 })).to.equal(Infinity)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(Infinity)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(formula.evaluate({ y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1' })).to.equal(null)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(null)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates ^', () => {

            const formula = new Formula.Parser('x^y')

            expect(formula.evaluate({ x: 2, y: 3 })).to.equal(8)
            expect(formula.evaluate({ y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1 })).to.equal(1)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(1)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(formula.evaluate({ y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1' })).to.equal(null)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(null)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates %', () => {

            const formula = new Formula.Parser('x%y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(1)
            expect(formula.evaluate({ y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1 })).to.equal(NaN)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(NaN)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(formula.evaluate({ y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1' })).to.equal(null)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(null)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('compares <', () => {

            const formula = new Formula.Parser('x<y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(false)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(false)
            expect(formula.evaluate({ y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1 })).to.equal(false)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(false)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal(false)
            expect(formula.evaluate({ y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1' })).to.equal(false)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(false)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(false)

            expect(formula.evaluate({ x: null, y: null })).to.equal(false)
            expect(formula.evaluate({ y: null })).to.equal(false)
            expect(formula.evaluate({ x: null })).to.equal(false)
            expect(formula.evaluate()).to.equal(false)
        })

        it('compares >', () => {

            const formula = new Formula.Parser('x>y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(true)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(false)
            expect(formula.evaluate({ y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1 })).to.equal(true)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(true)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal(false)
            expect(formula.evaluate({ y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1' })).to.equal(true)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(true)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(false)

            expect(formula.evaluate({ x: null, y: null })).to.equal(false)
            expect(formula.evaluate({ y: null })).to.equal(false)
            expect(formula.evaluate({ x: null })).to.equal(false)
            expect(formula.evaluate()).to.equal(false)
        })

        it('compares <=', () => {

            const formula = new Formula.Parser('x<=y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(false)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(true)
            expect(formula.evaluate({ y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1 })).to.equal(false)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(false)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal(true)
            expect(formula.evaluate({ y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1' })).to.equal(false)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(false)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(true)

            expect(formula.evaluate({ x: null, y: null })).to.equal(true)
            expect(formula.evaluate({ y: null })).to.equal(true)
            expect(formula.evaluate({ x: null })).to.equal(true)
            expect(formula.evaluate()).to.equal(true)
        })

        it('compares >=', () => {

            const formula = new Formula.Parser('x>=y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(true)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(true)
            expect(formula.evaluate({ y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1 })).to.equal(true)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(true)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal(true)
            expect(formula.evaluate({ y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1' })).to.equal(true)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(true)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(true)

            expect(formula.evaluate({ x: null, y: null })).to.equal(true)
            expect(formula.evaluate({ y: null })).to.equal(true)
            expect(formula.evaluate({ x: null })).to.equal(true)
            expect(formula.evaluate()).to.equal(true)
        })

        it('compares ==', () => {

            const formula = new Formula.Parser('x==y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(false)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(true)
            expect(formula.evaluate({ y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1 })).to.equal(false)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(false)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal(true)
            expect(formula.evaluate({ y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1' })).to.equal(false)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(false)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(false)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(false)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(false)

            expect(formula.evaluate({ x: null, y: null })).to.equal(true)
            expect(formula.evaluate({ y: null })).to.equal(true)
            expect(formula.evaluate({ x: null })).to.equal(true)
            expect(formula.evaluate()).to.equal(true)
        })

        it('compares !=', () => {

            const formula = new Formula.Parser('x!=y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(true)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(false)
            expect(formula.evaluate({ y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1 })).to.equal(true)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(true)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal(false)
            expect(formula.evaluate({ y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1' })).to.equal(true)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(true)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(true)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(true)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(true)

            expect(formula.evaluate({ x: null, y: null })).to.equal(false)
            expect(formula.evaluate({ y: null })).to.equal(false)
            expect(formula.evaluate({ x: null })).to.equal(false)
            expect(formula.evaluate()).to.equal(false)
        })

        it('applies logical ||', () => {

            const formula = new Formula.Parser('x || y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(10)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(10)
            expect(formula.evaluate({ x: 0, y: 10 })).to.equal(10)
            expect(formula.evaluate({ x: 0, y: 0 })).to.equal(0)
            expect(formula.evaluate({ y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1 })).to.equal(1)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(1)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal('1')
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal('1')
            expect(formula.evaluate({ x: '', y: '1' })).to.equal('1')
            expect(formula.evaluate({ x: '', y: '' })).to.equal('')
            expect(formula.evaluate({ y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1' })).to.equal('1')
            expect(formula.evaluate({ x: null, y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1', y: null })).to.equal('1')

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(1)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal('1')
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(1)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal('1')

            expect(formula.evaluate({ x: null, y: null })).to.equal(null)
            expect(formula.evaluate({ y: null })).to.equal(null)
            expect(formula.evaluate({ x: null })).to.equal(null)
            expect(formula.evaluate()).to.equal(null)
        })

        it('applies logical &&', () => {

            const formula = new Formula.Parser('x && y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(3)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(10)
            expect(formula.evaluate({ x: 0, y: 10 })).to.equal(0)
            expect(formula.evaluate({ x: 0, y: 0 })).to.equal(0)
            expect(formula.evaluate({ y: 2 })).to.equal(null)
            expect(formula.evaluate({ x: 1 })).to.equal(null)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(null)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(null)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal('1')
            expect(formula.evaluate({ x: '', y: '1' })).to.equal('')
            expect(formula.evaluate({ x: '', y: '' })).to.equal('')
            expect(formula.evaluate({ y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1' })).to.equal(null)
            expect(formula.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(formula.evaluate({ x: '1', y: null })).to.equal(null)

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal('1')
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal(1)

            expect(formula.evaluate({ x: null, y: null })).to.equal(null)
            expect(formula.evaluate({ y: null })).to.equal(null)
            expect(formula.evaluate({ x: null })).to.equal(null)
            expect(formula.evaluate()).to.equal(null)
        })

        it('applies logical ??', () => {

            const formula = new Formula.Parser('x ?? y')

            expect(formula.evaluate({ x: 10, y: 3 })).to.equal(10)
            expect(formula.evaluate({ x: 10, y: 10 })).to.equal(10)
            expect(formula.evaluate({ x: 0, y: 10 })).to.equal(0)
            expect(formula.evaluate({ x: 0, y: 0 })).to.equal(0)
            expect(formula.evaluate({ y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1 })).to.equal(1)
            expect(formula.evaluate({ x: null, y: 2 })).to.equal(2)
            expect(formula.evaluate({ x: 1, y: null })).to.equal(1)

            expect(formula.evaluate({ x: '1', y: '2' })).to.equal('1')
            expect(formula.evaluate({ x: '1', y: '1' })).to.equal('1')
            expect(formula.evaluate({ x: '', y: '1' })).to.equal('')
            expect(formula.evaluate({ x: '', y: '' })).to.equal('')
            expect(formula.evaluate({ y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1' })).to.equal('1')
            expect(formula.evaluate({ x: null, y: '2' })).to.equal('2')
            expect(formula.evaluate({ x: '1', y: null })).to.equal('1')

            expect(formula.evaluate({ x: 1, y: '2' })).to.equal(1)
            expect(formula.evaluate({ x: '1', y: 2 })).to.equal('1')
            expect(formula.evaluate({ x: 1, y: '1' })).to.equal(1)
            expect(formula.evaluate({ x: '1', y: 1 })).to.equal('1')

            expect(formula.evaluate({ x: null, y: null })).to.equal(null)
            expect(formula.evaluate({ y: null })).to.equal(null)
            expect(formula.evaluate({ x: null })).to.equal(null)
            expect(formula.evaluate()).to.equal(null)
        })
    })
})
