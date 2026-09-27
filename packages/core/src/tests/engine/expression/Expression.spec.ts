/**
 * Ported from the upstream test/index.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Expression from '../../../lib/validation/engine/expression/index.js'
const internals = {}

describe('Expression', () => {

    it('evaluates a expression', () => {

        const functions = {
            x: (value) => value + 10
        }

        const constants = {
            Z: 100
        }

        const expression = new Expression.Parser('1 + a.b.c.2.4.x + [b] + x([y + 4] + Z)', { functions, constants })
        expect(expression.evaluate({ 'a.b.c.2.4.x': 2, b: 3, 'y + 4': 5 })).to.equal(1 + 2 + 3 + 5 + 10 + 100)
        expect(expression.evaluate({ 'a.b.c.2.4.x': '2', b: 3, 'y + 4': '5' })).to.equal('123510010')
    })

    it('evaluates a expression (custom reference handler)', () => {

        const functions = {
            x: (value) => value + 10
        }

        const constants = {
            Z: 100
        }

        const reference = function (name) {

            return (context) => context[name]
        }

        const expression = new Expression.Parser('1 + a.b.c.2.4.x + [b] + x([y + 4] + Z)', { functions, constants, reference })
        expect(expression.evaluate({ 'a.b.c.2.4.x': 2, b: 3, 'y + 4': 5 })).to.equal(1 + 2 + 3 + 5 + 10 + 100)
        expect(expression.evaluate({ 'a.b.c.2.4.x': '2', b: 3, 'y + 4': '5' })).to.equal('123510010')
    })

    describe('constructor()', () => {

        it('allows valid constant', () => {

            expect(() => new Expression.Parser('1 + x', { constants: { x: true } })).to.not.throw()
            expect(() => new Expression.Parser('1 + x', { constants: { x: 1 } })).to.not.throw()
            expect(() => new Expression.Parser('1 + x', { constants: { x: 'x' } })).to.not.throw()
            expect(() => new Expression.Parser('1 + x', { constants: { x: null } })).to.not.throw()
        })

        it('errors on invalid constant', () => {

            expect(() => new Expression.Parser('1 + x', { constants: { x: {} } })).to.throw('Expression constant x contains invalid object value type')
            expect(() => new Expression.Parser('1 + x', { constants: { x: () => null } })).to.throw('Expression constant x contains invalid function value type')
            expect(() => new Expression.Parser('1 + x', { constants: { x: undefined } })).to.throw('Expression constant x contains invalid undefined value type')
        })
    })

    describe('single', () => {

        it('identifies single literal (string)', () => {

            const expression = new Expression.Parser('"x"')
            expect(expression.single).to.equal({ type: 'value', value: 'x' })
        })

        it('identifies single literal (number)', () => {

            const expression = new Expression.Parser('123')
            expect(expression.single).to.equal({ type: 'value', value: 123 })
        })

        it('identifies single literal (constant)', () => {

            const expression = new Expression.Parser('x', { constants: { x: 'y' } })
            expect(expression.single).to.equal({ type: 'value', value: 'y' })
        })

        it('identifies single reference', () => {

            const expression = new Expression.Parser('x')
            expect(expression.single).to.equal({ type: 'reference', value: 'x' })
        })

        it('identifies non-single reference', () => {

            const expression = new Expression.Parser('-x')
            expect(expression.single).to.be.null()
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

            const expression = new Expression.Parser('x(10) + y(z(30)) + z(x(40)) + a()', { functions })
            expect(expression.evaluate()).to.equal(11 + 33 + 2 + 41 + 3 + 9)
        })

        it('passes context as this to functions', () => {

            const functions = {
                x: function () {

                    return this.X
                }
            }

            const expression = new Expression.Parser('x()', { functions })
            expect(expression.evaluate({ X: 1 })).to.equal(1)
        })

        it('parses parenthesis', () => {

            const expression = new Expression.Parser('(x + 4) * (x - 5) / (x ^ 2)')
            expect(expression.evaluate({ x: 10 })).to.equal((10 + 4) * (10 - 5) / (Math.pow(10, 2)))
        })

        it('parses string literals', () => {

            const expression = new Expression.Parser('"x+3" + `y()` + \'-z\'')
            expect(expression.evaluate()).to.equal('x+3y()-z')
        })

        it('validates token', () => {

            expect(() => new Expression.Parser('[xy]', { tokenRx: /^\w+$/ })).to.not.throw()
            expect(() => new Expression.Parser('[x y]', { tokenRx: /^\w+$/ })).to.throw('Expression contains invalid reference x y')
        })

        it('errors on missing closing parenthesis', () => {

            expect(() => new Expression.Parser('(a + 2(')).to.throw('Expression missing closing parenthesis')
        })

        it('errors on invalid character', () => {

            expect(() => new Expression.Parser('x\u0000')).to.throw('Expression contains invalid token: x\u0000')
        })

        it('errors on invalid operator position', () => {

            expect(() => new Expression.Parser('x + + y')).to.throw('Expression contains an operator in invalid position')
            expect(() => new Expression.Parser('x + y +')).to.throw('Expression contains invalid trailing operator')
        })

        it('errors on invalid operator', () => {

            expect(() => new Expression.Parser('x | y')).to.throw('Expression contains an unknown operator |')
        })

        it('errors on invalid missing operator', () => {

            expect(() => new Expression.Parser('x y')).to.throw('Expression missing expected operator')
        })
    })

    describe('_subExpression', () => {

        it('parses multiple nested functions with arguments (numbers)', () => {

            const functions = {
                x: (a, b, c) => a + b + c,
                y: (a, b) => a * b,
                z: (value) => value + 3,
                a: () => 9
            }

            const expression = new Expression.Parser('x(10, (y((1 + 2), z(30)) + a()), z(x(4, 5, 6)))', { functions })
            expect(expression.evaluate()).to.equal(10 + (((1 + 2) * (30 + 3)) + 9) + (4 + 5 + 6) + 3)
        })

        it('parses multiple nested functions with arguments (strings)', () => {

            const functions = {
                x: (a, b, c) => a + b + c,
                y: (a, b) => a + b,
                z: (value) => value + 3,
                a: () => 9
            }

            const expression = new Expression.Parser('x("10", (y(("1" + "2"), z("30")) + a()), z(x("4", "5", "6")))', { functions })
            expect(expression.evaluate()).to.equal('101230394563')
        })

        it('errors on unknown function', () => {

            expect(() => new Expression.Parser('x()')).to.throw('Expression contains unknown function x')
        })

        it('errors on invalid function arguments', () => {

            expect(() => new Expression.Parser('x(y,)', { functions: { x: () => null } })).to.throw('Expression contains function x with invalid arguments y,')
        })
    })

    describe('evaluate()', () => {

        it('handles null constant', () => {

            const expression = new Expression.Parser('0 + null', { constants: { null: null } })

            expect(expression.evaluate()).to.equal(0)
        })
    })

    describe('single()', () => {

        it('calculates -', () => {

            const expression = new Expression.Parser('-x')

            expect(expression.evaluate({ x: 1 })).to.equal(-1)
            expect(expression.evaluate({ x: -1 })).to.equal(1)
            expect(expression.evaluate({ x: 0 })).to.equal(0)
        })

        it('handles --', () => {

            const expression = new Expression.Parser('10--x')

            expect(expression.evaluate({ x: 1 })).to.equal(11)
            expect(expression.evaluate({ x: -1 })).to.equal(9)
            expect(expression.evaluate({ x: 0 })).to.equal(10)
        })

        it('calculates !', () => {

            const expression = new Expression.Parser('!x')

            expect(expression.evaluate({ x: 1 })).to.equal(false)
            expect(expression.evaluate({ x: -1 })).to.equal(false)
            expect(expression.evaluate({ x: 0 })).to.equal(true)
        })
    })

    describe('calculate()', () => {

        it('calculates +', () => {

            const expression = new Expression.Parser('x+y')

            expect(expression.evaluate({ x: 1, y: 2 })).to.equal(3)
            expect(expression.evaluate({ y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1 })).to.equal(1)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(1)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal('12')
            expect(expression.evaluate({ y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1' })).to.equal('1')
            expect(expression.evaluate({ x: null, y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1', y: null })).to.equal('1')

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal('12')
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal('12')
        })

        it('calculates -', () => {

            const expression = new Expression.Parser('x-y')

            expect(expression.evaluate({ x: 1, y: 2 })).to.equal(-1)
            expect(expression.evaluate({ y: 2 })).to.equal(-2)
            expect(expression.evaluate({ x: 1 })).to.equal(1)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(-2)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(1)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(expression.evaluate({ y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1' })).to.equal(null)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(null)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates *', () => {

            const expression = new Expression.Parser('x*y')

            expect(expression.evaluate({ x: 20, y: 10 })).to.equal(200)
            expect(expression.evaluate({ y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1 })).to.equal(0)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(0)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(expression.evaluate({ y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1' })).to.equal(null)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(null)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates /', () => {

            const expression = new Expression.Parser('x/y')

            expect(expression.evaluate({ x: 20, y: 10 })).to.equal(2)
            expect(expression.evaluate({ y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1 })).to.equal(Infinity)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(Infinity)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(expression.evaluate({ y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1' })).to.equal(null)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(null)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates ^', () => {

            const expression = new Expression.Parser('x^y')

            expect(expression.evaluate({ x: 2, y: 3 })).to.equal(8)
            expect(expression.evaluate({ y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1 })).to.equal(1)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(1)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(expression.evaluate({ y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1' })).to.equal(null)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(null)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('calculates %', () => {

            const expression = new Expression.Parser('x%y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(1)
            expect(expression.evaluate({ y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1 })).to.equal(NaN)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(0)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(NaN)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(null)
            expect(expression.evaluate({ y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1' })).to.equal(null)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(null)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(null)
        })

        it('compares <', () => {

            const expression = new Expression.Parser('x<y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(false)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(false)
            expect(expression.evaluate({ y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1 })).to.equal(false)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(false)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal(false)
            expect(expression.evaluate({ y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1' })).to.equal(false)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(false)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(false)

            expect(expression.evaluate({ x: null, y: null })).to.equal(false)
            expect(expression.evaluate({ y: null })).to.equal(false)
            expect(expression.evaluate({ x: null })).to.equal(false)
            expect(expression.evaluate()).to.equal(false)
        })

        it('compares >', () => {

            const expression = new Expression.Parser('x>y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(true)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(false)
            expect(expression.evaluate({ y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1 })).to.equal(true)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(true)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal(false)
            expect(expression.evaluate({ y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1' })).to.equal(true)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(true)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(false)

            expect(expression.evaluate({ x: null, y: null })).to.equal(false)
            expect(expression.evaluate({ y: null })).to.equal(false)
            expect(expression.evaluate({ x: null })).to.equal(false)
            expect(expression.evaluate()).to.equal(false)
        })

        it('compares <=', () => {

            const expression = new Expression.Parser('x<=y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(false)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(true)
            expect(expression.evaluate({ y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1 })).to.equal(false)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(false)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal(true)
            expect(expression.evaluate({ y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1' })).to.equal(false)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(false)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(true)

            expect(expression.evaluate({ x: null, y: null })).to.equal(true)
            expect(expression.evaluate({ y: null })).to.equal(true)
            expect(expression.evaluate({ x: null })).to.equal(true)
            expect(expression.evaluate()).to.equal(true)
        })

        it('compares >=', () => {

            const expression = new Expression.Parser('x>=y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(true)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(true)
            expect(expression.evaluate({ y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1 })).to.equal(true)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(true)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal(true)
            expect(expression.evaluate({ y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1' })).to.equal(true)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(true)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(true)

            expect(expression.evaluate({ x: null, y: null })).to.equal(true)
            expect(expression.evaluate({ y: null })).to.equal(true)
            expect(expression.evaluate({ x: null })).to.equal(true)
            expect(expression.evaluate()).to.equal(true)
        })

        it('compares ==', () => {

            const expression = new Expression.Parser('x==y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(false)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(true)
            expect(expression.evaluate({ y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1 })).to.equal(false)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(false)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal(true)
            expect(expression.evaluate({ y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1' })).to.equal(false)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(false)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(false)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(false)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(false)

            expect(expression.evaluate({ x: null, y: null })).to.equal(true)
            expect(expression.evaluate({ y: null })).to.equal(true)
            expect(expression.evaluate({ x: null })).to.equal(true)
            expect(expression.evaluate()).to.equal(true)
        })

        it('compares !=', () => {

            const expression = new Expression.Parser('x!=y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(true)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(false)
            expect(expression.evaluate({ y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1 })).to.equal(true)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(true)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal(false)
            expect(expression.evaluate({ y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1' })).to.equal(true)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(true)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(true)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(true)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(true)

            expect(expression.evaluate({ x: null, y: null })).to.equal(false)
            expect(expression.evaluate({ y: null })).to.equal(false)
            expect(expression.evaluate({ x: null })).to.equal(false)
            expect(expression.evaluate()).to.equal(false)
        })

        it('applies logical ||', () => {

            const expression = new Expression.Parser('x || y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(10)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(10)
            expect(expression.evaluate({ x: 0, y: 10 })).to.equal(10)
            expect(expression.evaluate({ x: 0, y: 0 })).to.equal(0)
            expect(expression.evaluate({ y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1 })).to.equal(1)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(1)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal('1')
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal('1')
            expect(expression.evaluate({ x: '', y: '1' })).to.equal('1')
            expect(expression.evaluate({ x: '', y: '' })).to.equal('')
            expect(expression.evaluate({ y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1' })).to.equal('1')
            expect(expression.evaluate({ x: null, y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1', y: null })).to.equal('1')

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(1)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal('1')
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(1)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal('1')

            expect(expression.evaluate({ x: null, y: null })).to.equal(null)
            expect(expression.evaluate({ y: null })).to.equal(null)
            expect(expression.evaluate({ x: null })).to.equal(null)
            expect(expression.evaluate()).to.equal(null)
        })

        it('applies logical &&', () => {

            const expression = new Expression.Parser('x && y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(3)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(10)
            expect(expression.evaluate({ x: 0, y: 10 })).to.equal(0)
            expect(expression.evaluate({ x: 0, y: 0 })).to.equal(0)
            expect(expression.evaluate({ y: 2 })).to.equal(null)
            expect(expression.evaluate({ x: 1 })).to.equal(null)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(null)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(null)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal('1')
            expect(expression.evaluate({ x: '', y: '1' })).to.equal('')
            expect(expression.evaluate({ x: '', y: '' })).to.equal('')
            expect(expression.evaluate({ y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1' })).to.equal(null)
            expect(expression.evaluate({ x: null, y: '2' })).to.equal(null)
            expect(expression.evaluate({ x: '1', y: null })).to.equal(null)

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal('1')
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal(1)

            expect(expression.evaluate({ x: null, y: null })).to.equal(null)
            expect(expression.evaluate({ y: null })).to.equal(null)
            expect(expression.evaluate({ x: null })).to.equal(null)
            expect(expression.evaluate()).to.equal(null)
        })

        it('applies logical ??', () => {

            const expression = new Expression.Parser('x ?? y')

            expect(expression.evaluate({ x: 10, y: 3 })).to.equal(10)
            expect(expression.evaluate({ x: 10, y: 10 })).to.equal(10)
            expect(expression.evaluate({ x: 0, y: 10 })).to.equal(0)
            expect(expression.evaluate({ x: 0, y: 0 })).to.equal(0)
            expect(expression.evaluate({ y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1 })).to.equal(1)
            expect(expression.evaluate({ x: null, y: 2 })).to.equal(2)
            expect(expression.evaluate({ x: 1, y: null })).to.equal(1)

            expect(expression.evaluate({ x: '1', y: '2' })).to.equal('1')
            expect(expression.evaluate({ x: '1', y: '1' })).to.equal('1')
            expect(expression.evaluate({ x: '', y: '1' })).to.equal('')
            expect(expression.evaluate({ x: '', y: '' })).to.equal('')
            expect(expression.evaluate({ y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1' })).to.equal('1')
            expect(expression.evaluate({ x: null, y: '2' })).to.equal('2')
            expect(expression.evaluate({ x: '1', y: null })).to.equal('1')

            expect(expression.evaluate({ x: 1, y: '2' })).to.equal(1)
            expect(expression.evaluate({ x: '1', y: 2 })).to.equal('1')
            expect(expression.evaluate({ x: 1, y: '1' })).to.equal(1)
            expect(expression.evaluate({ x: '1', y: 1 })).to.equal('1')

            expect(expression.evaluate({ x: null, y: null })).to.equal(null)
            expect(expression.evaluate({ y: null })).to.equal(null)
            expect(expression.evaluate({ x: null })).to.equal(null)
            expect(expression.evaluate()).to.equal(null)
        })
    })
})
