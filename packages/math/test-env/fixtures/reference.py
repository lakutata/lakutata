# The expected results of the fixtures, computed by SymPy: for each case of cases/*.json, the result printed in the
# syntax of @lakutata/math and its values at the sample points (30 significant digits), written to expected/*.json.
# Run by generate.sh in a container (python3 and py3-sympy of Alpine), not by the tests.

import decimal
import functools
import itertools
import json
import math
import os
import sys

import mpmath
import sympy
from sympy import (Abs, E, I, Integer, LambertW, Max, Min, Rational, S, Symbol, ceiling, conjugate, floor, linsolve,
                   log, loggamma, nan, oo, sign, solveset, zoo)
from sympy.core.intfunc import igcdex, mod_inverse
from sympy.functions.combinatorial.factorials import binomial, factorial, factorial2, ff
from sympy.functions.combinatorial.numbers import (bell, bernoulli, catalan, fibonacci, harmonic, jacobi_symbol,
                                                   legendre_symbol, lucas, mobius, stirling, totient)
from sympy.ntheory import factorint, isprime, nextprime, primitive_root
from sympy.ntheory.modular import crt
from sympy.parsing.sympy_parser import (convert_xor, implicit_multiplication, parse_expr, rationalize,
                                        standard_transformations)
from sympy.printing.str import StrPrinter

HERE = os.path.dirname(os.path.abspath(__file__))
DIGITS = 30

# The values of the variables at the sample points: exact decimals, the same in the tests
POINTS = [
    {'x': '0.7', 'y': '1.3', 'z': '-0.4', 'a': '2.1', 'b': '-1.7', 'c': '0.3', 'd': '1.1', 't': '0.35'},
    {'x': '-1.9', 'y': '0.45', 'z': '2.6', 'a': '-0.8', 'b': '3.2', 'c': '-2.3', 'd': '0.6', 't': '1.75'}
]

# The names of the syntax of @lakutata/math that SymPy spells differently
NAMES = {
    'e': E, 'i': I, 'pi': sympy.pi, 'inf': oo, 'oo': oo, 'nan': nan, 'ln': log, 'abs': Abs, 'ceil': ceiling,
    'trunc': lambda value: sign(value) * floor(Abs(value)), 'conj': conjugate, 'loggamma': loggamma,
    'lambertw': LambertW, 'log10': lambda value: log(value, 10), 'log2': lambda value: log(value, 2), 'min': Min,
    'max': Max,
    # The real root of a negative real number for an odd order, the principal one otherwise
    'cbrt': lambda value: sympy.real_root(value, 3), 'root': lambda value, n: sympy.real_root(value, n),
    # Halves away from zero (not the halves to even of Python's round), the sign of the divisor
    'round': lambda value: sign(value) * floor(Abs(value) + Rational(1, 2)), 'mod': sympy.Mod, 'sinc': sympy.sinc,
    're': sympy.re, 'im': sympy.im, 'arg': sympy.arg, 'hypot': lambda a, b: sympy.sqrt(a ** 2 + b ** 2),
    'expm1': lambda value: sympy.exp(value) - 1, 'log1p': lambda value: log(1 + value),
    'lowergamma': sympy.lowergamma, 'uppergamma': sympy.uppergamma,
    'gcd': lambda *values: functools.reduce(sympy.igcd, values), 'lcm': lambda *values: functools.reduce(sympy.ilcm, values),
    'phi': S.GoldenRatio, 'tau': 2 * sympy.pi, 'EulerGamma': S.EulerGamma, 'Catalan': S.Catalan
}
TRANSFORMATIONS = standard_transformations + (implicit_multiplication, convert_xor, rationalize)


def parse(text):
    """A formula in the syntax of @lakutata/math, read by SymPy"""
    return parse_expr(text, local_dict=dict(NAMES), transformations=TRANSFORMATIONS)


def meaning(text):
    """An expression written for SymPy (the meaning of a grammar case)"""
    return sympy.sympify(text, locals={'e': E, 'i': I, 'real_root': sympy.real_root})


class Printer(StrPrinter):
    """SymPy's expressions in the syntax of @lakutata/math"""

    def _print_ImaginaryUnit(self, expr):
        return 'i'

    def _print_Exp1(self, expr):
        return 'e'

    def _print_Infinity(self, expr):
        return 'inf'

    def _print_NegativeInfinity(self, expr):
        return '-inf'

    def _print_Function(self, expr):
        names = {'Abs': 'abs', 'ceiling': 'ceil', 'conjugate': 'conj', 'LambertW': 'lambertw', 'Min': 'min',
                 'Max': 'max'}
        name = names.get(expr.func.__name__, expr.func.__name__)
        return name + '(' + ', '.join(self._print(argument) for argument in expr.args) + ')'

    def _print_Abs(self, expr):
        return 'abs(' + self._print(expr.args[0]) + ')'

    def _print_exp(self, expr):
        return 'exp(' + self._print(expr.args[0]) + ')'


def text_of(expr):
    if expr.has(zoo):
        return None
    return Printer().doprint(expr)


def number(value):
    """A complex value as [re, im] strings of 30 digits"""
    value = sympy.N(value, DIGITS)
    re, im = value.as_real_imag()
    return [str(sympy.N(re, DIGITS)), str(sympy.N(im, DIGITS))]


def values_at(expr, points=POINTS):
    """The values of an expression at the sample points: [re, im] strings, or null where it has no finite value"""
    values = []
    for point in points:
        substituted = expr.subs({Symbol(name): Rational(value) for name, value in point.items()})
        value = sympy.N(substituted, DIGITS)
        if value.has(nan, zoo, oo, -oo) or not value.is_number:
            values.append(None)
        else:
            values.append(number(value))
    return values


def decimal_text(expr, digits):
    """The decimal of an expression rounded to a number of significant digits: computed with 30 more, then rounded half
    to even by Python's decimal (SymPy's N(expr, digits) can be one unit off in its last digit: sin(355))"""
    value = decimal.Decimal(str(sympy.N(expr, digits + 30)).replace('*^', 'e'))
    with decimal.localcontext() as context:
        context.prec = digits
        context.rounding = decimal.ROUND_HALF_EVEN
        return str(+value).lower()


def load(name):
    with open(os.path.join(HERE, 'cases', name + '.json')) as file:
        return json.load(file)


WRITTEN = []


def save(name, results):
    WRITTEN.append(name + '.json')
    os.makedirs(os.path.join(HERE, 'expected'), exist_ok=True)
    with open(os.path.join(HERE, 'expected', name + '.json'), 'w') as file:
        json.dump({'generator': {'sympy': sympy.__version__, 'mpmath': mpmath.__version__}, 'points': POINTS,
                   'cases': results}, file, indent=1, ensure_ascii=False)
        file.write('\n')


def grammar():
    results = []
    for case in load('grammar'):
        result = {'text': case['text']}
        if 'error' in case:
            result['error'] = case['error']
        else:
            result['values'] = values_at(meaning(case['meaning']))
        results.append(result)
    save('grammar', results)


def numbers():
    results = []
    for case in load('numbers'):
        expr = parse(case['text'])
        result = {'text': case['text'], 'value': number(expr), 'exact': text_of(expr)}
        if 'doubles' in case:
            result['doubles'] = case['doubles']
        if case.get('decimals'):
            result['decimals'] = {str(digits): decimal_text(expr, digits) for digits in case['decimals']}
        results.append(result)
    save('numbers', results)


def operations(name, operate):
    results = []
    for case in load(name):
        expr = parse(case['text'])
        value = operate(expr, case)
        results.append({**case, 'result': text_of(value), 'values': values_at(value)})
    save(name, results)


def series(expr, case):
    variable = Symbol(case['variable'])
    point = parse(case.get('point', '0'))
    return sympy.series(expr, variable, point, case['order']).removeO()


def substitute(expr, case):
    return expr.subs({Symbol(name): parse(str(value)) for name, value in case['with'].items()}, simultaneous=True)


def solve():
    results = []
    for case in load('solve'):
        expr = parse(case['text'])
        domain = S.Reals if case.get('domain') == 'real' else S.Complexes
        found = solveset(expr, Symbol(case['variable']), domain)
        result = dict(case)
        if found == S.EmptySet:
            result['kind'] = 'empty'
        elif found == domain:
            result['kind'] = 'all'
        elif isinstance(found, sympy.ConditionSet):
            result['kind'] = 'unsolved'
        elif isinstance(found, sympy.FiniteSet):
            result['kind'] = 'finite'
            result['solutions'] = [{'text': text_of(value), 'values': values_at(value)} for value in found.args]
        else:
            result['kind'] = 'other'
            result['set'] = str(found)
        results.append(result)
    save('solve', results)


def systems():
    results = []
    for case in load('systems'):
        variables = [Symbol(name) for name in case['variables']]
        equations = []
        for text in case['equations']:
            if '=' in text:
                left, right = text.split('=')
                equations.append(parse(left) - parse(right))
            else:
                equations.append(parse(text))
        found = linsolve(equations, variables)
        result = dict(case)
        if found == S.EmptySet:
            result['kind'] = 'empty'
        else:
            (solution,) = found.args
            result['kind'] = 'finite'
            result['values'] = {str(variable): {'text': text_of(value), 'values': values_at(value)}
                                for variable, value in zip(variables, solution) if value != variable}
        results.append(result)
    save('systems', results)


def polynomials():
    results = []
    for case in load('polynomials'):
        expr = parse(case['text'])
        variable = Symbol(case['variable'])
        poly = sympy.Poly(expr, variable)
        result = dict(case)
        result['degree'] = poly.degree()
        result['coefficients'] = [{'text': text_of(c), 'values': values_at(c)} for c in reversed(poly.all_coeffs())]
        if 'divisor' in case:
            quotient, remainder = sympy.div(expr, parse(case['divisor']), variable)
            result['quotient'] = {'text': text_of(quotient), 'values': values_at(quotient)}
            result['remainder'] = {'text': text_of(remainder), 'values': values_at(remainder)}
        results.append(result)
    save('polynomials', results)


def chernick(start):
    """The first Carmichael number (6k + 1)(12k + 1)(18k + 1) from k = start, its three factors primes"""
    k = start
    while not (isprime(6 * k + 1) and isprime(12 * k + 1) and isprime(18 * k + 1)):
        k += 1
    return (6 * k + 1) * (12 * k + 1) * (18 * k + 1)


def or_none(value):
    return None if value is None else str(value)


def inverse(a, m):
    try:
        return str(mod_inverse(a, m))
    except ValueError:
        return None


# The operations of math.ntheory by SymPy (and Python's integers), their results as the tests compare them: integers
# as decimal strings, null for no value
def natural(*values):
    """True where every value is 0 or more (for use as an operand of and); a ValueError otherwise, as the combinatorics
    refuse negative counts"""
    if any(value < 0 for value in values):
        raise ValueError('a negative count')
    return True


NUMBER_THEORY = {
    'gcd': lambda values: str(math.gcd(*values)),
    'lcm': lambda values: str(math.lcm(*values)),
    'extendedGcd': lambda a, b: (lambda x, y, g: [str(g), str(x), str(y)])(*igcdex(a, b)),
    'mod': lambda a, m: str(a % m),
    'modInverse': inverse,
    'powMod': lambda base, exponent, m: str(pow(base, exponent, m)),
    'isPrime': lambda n: bool(isprime(n)),
    'nextPrime': lambda n: str(nextprime(n)),
    'factor': lambda n: [[str(p), e] for p, e in sorted(factorint(n).items())],
    'totient': lambda n: str(totient(n)),
    'mobius': lambda n: int(mobius(n)),
    'primitiveRoot': lambda n: or_none(primitive_root(n)),
    'legendre': lambda a, p: int(legendre_symbol(a, p)),
    'jacobi': lambda a, n: int(jacobi_symbol(a, n)),
    'crt': lambda remainders, moduli: (lambda found: None if found is None else [str(found[0]), str(found[1])])(
        crt(moduli, remainders) if moduli else (0, 1)),
    'fibonacci': lambda n: str(fibonacci(n)),
    'lucas': lambda n: str(lucas(n)),
    'binomial': lambda n, k: str(binomial(n, k)),
    'factorial': lambda n: str(factorial(n)),
    'doubleFactorial': lambda n: str(factorial2(n)),
    'bernoulli': lambda n: str(bernoulli(n)),
    'harmonic': lambda n: str(harmonic(n)),
    'permutations': lambda n, k=None: str(natural(n, n if k is None else k) and (factorial(n) if k is None else ff(n, k))),
    'combinationsWithRepetition': lambda n, k: str(natural(n, k) and binomial(n + k - 1, k)),
    'multinomial': lambda counts: str(natural(*counts) and factorial(sum(counts)) // math.prod(factorial(c) for c in counts)),
    'bell': lambda n: str(natural(n) and bell(n)),
    'catalan': lambda n: str(natural(n) and catalan(n)),
    'stirlingSecondKind': lambda n, k: str(natural(n, k) and stirling(n, k)),
    # The compositions of n into k parts, C(n - 1, k - 1) of positive n and k
    'compositions': lambda n, k: str(natural(n, k) and (binomial(n - 1, k - 1) if n > 0 and k > 0 else int(n == k))),
}


def ntheory():
    results = []
    for case in load('ntheory'):
        result = dict(case)
        if 'chernick' in case:
            result['args'] = [str(chernick(case['chernick']))]
        args = [[int(v) for v in arg] if isinstance(arg, list) else int(arg) for arg in result['args']]
        operate = NUMBER_THEORY[case['op']]
        if 'error' in case:
            # SymPy refuses it too, unless its difference is written down
            if 'sympy' not in case.get('differs', {}):
                try:
                    operate(*args)
                except (ValueError, ZeroDivisionError):
                    pass
                else:
                    raise AssertionError('SymPy accepts ' + json.dumps(case))
        else:
            result['result'] = operate(*args)
        results.append(result)
    save('ntheory', results)


# The continued fractions by SymPy: of a rational number its terms (continued_fraction), of another value its first
# terms (continued_fraction_iterator); the values and the convergents of terms (continued_fraction_reduce,
# continued_fraction_convergents); integers as decimal strings, fractions as SymPy prints them
def finite(value):
    """A value of SymPy that is a number: a division by zero is zoo, an error"""
    if value.has(sympy.zoo, sympy.nan):
        raise ZeroDivisionError('a division by zero')
    return value


CONTINUED = {
    'continuedFraction': lambda case: [str(term) for term in (
        sympy.continued_fraction(parse(case['value'])) if parse(case['value']).is_rational
        else itertools.islice(sympy.continued_fraction_iterator(parse(case['value'])), case.get('terms', 20)))],
    'fromContinuedFraction': lambda case: str(finite(sympy.continued_fraction_reduce([int(t) for t in case['terms']]))),
    'convergents': lambda case: [str(finite(c)) for c in sympy.continued_fraction_convergents([int(t) for t in case['terms']])],
}


def continued_fractions():
    results = []
    for case in load('continued'):
        result = dict(case)
        if 'error' in case:
            try:
                CONTINUED[case['op']](case)
            except (ValueError, ZeroDivisionError):
                pass
            else:
                raise AssertionError('SymPy accepts ' + json.dumps(case))
        elif 'expected' in case:
            # SymPy's differs, noted in the case
            result['result'] = case['expected']
        else:
            result['result'] = CONTINUED[case['op']](case)
        results.append(result)
    save('continued', results)


# The matrices of expressions by SymPy's Matrix: each element as its text and its values at the points (the forms of
# the elements may differ: the tests compare their values); the null spaces and the eigenvectors by their counts (their
# bases may be scaled differently)
def matrix_of(rows):
    return sympy.Matrix([[parse(element) for element in row] for row in rows])


def expression_result(expr):
    return {'text': text_of(expr), 'values': values_at(expr)}


def matrix_result(m):
    return {'rows': m.rows, 'columns': m.cols, 'elements': [expression_result(element) for element in m]}


MATRIX_OPERATIONS = {
    'determinant': lambda m, case: expression_result(m.det()),
    'inverse': lambda m, case: matrix_result(m.inv()),
    'solve': lambda m, case: matrix_result(m.LUsolve(matrix_of(case['b']))),
    'rref': lambda m, case: (lambda form: {'matrix': matrix_result(form[0]), 'pivots': list(form[1])})(m.rref()),
    'rank': lambda m, case: m.rank(),
    'nullspace': lambda m, case: len(m.nullspace()),
    'characteristicPolynomial': lambda m, case: expression_result(m.charpoly(Symbol('lambda')).as_expr()),
    'eigenvectors': lambda m, case: [{'value': expression_result(value), 'multiplicity': int(multiplicity), 'count': len(vectors)}
                                     for value, multiplicity, vectors in m.eigenvects()],
    'pow': lambda m, case: matrix_result(m ** case['exponent']),
    'mul': lambda m, case: matrix_result(m * matrix_of(case['other'])),
}


def matrices():
    results = []
    for case in load('matrices'):
        result = dict(case)
        if case['op'] == 'parse':
            meaning = sympy.sympify(case['meaning'], locals={'Matrix': sympy.Matrix, 'x': Symbol('x'), 'y': Symbol('y'), 'a': Symbol('a'),
                                                             'b': Symbol('b'), 'c': Symbol('c'), 'd': Symbol('d')})
            result['result'] = matrix_result(meaning) if isinstance(meaning, sympy.MatrixBase) else expression_result(meaning)
        elif 'error' in case:
            try:
                MATRIX_OPERATIONS[case['op']](matrix_of(case['rows']), case)
            except (ValueError, ZeroDivisionError):
                pass
            else:
                raise AssertionError('SymPy accepts ' + json.dumps(case))
        elif 'expected' in case:
            result['result'] = case['expected']
        else:
            result['result'] = MATRIX_OPERATIONS[case['op']](matrix_of(case['rows']), case)
        results.append(result)
    save('matrices', results)


def decimal_result(value, digits):
    """A decimal rounded to a number of significant digits (halves to even), written as Decimal.toString() writes it:
    its shortest digits, fixed for the exponents from -6 to digits - 1, scientific beyond"""
    with decimal.localcontext() as context:
        context.prec = digits
        context.rounding = decimal.ROUND_HALF_EVEN
        value = +value
        if value == 0:
            return '0'
        value = value.normalize()
    return format(value, 'f' if -6 <= value.adjusted() < digits else 'e')


def mpmath_result(operate, digits, *values):
    """The value of a function of mpmath, 30 more digits, then rounded half to even"""
    with mpmath.workdps(digits + 30):
        value = operate(*[mpmath.mpf(str(v)) for v in values])
        return decimal_result(decimal.Decimal(mpmath.nstr(value, digits + 30)), digits)


def exact(operate):
    """An operation of Python's decimal computed exactly (100000 digits), the sign of a remainder fixed"""
    with decimal.localcontext() as context:
        context.prec = 100000
        context.Emax = decimal.MAX_EMAX
        context.Emin = decimal.MIN_EMIN
        context.traps[decimal.Inexact] = True
        return operate()


def remainder(a, b):
    """a - b floor(a/b): the remainder of the sign of b"""
    r = exact(lambda: a % b)
    return exact(lambda: r + b) if r != 0 and (r < 0) != (b < 0) else r


def quantized(a, places):
    """a rounded to a number of places, halves away from zero"""
    with decimal.localcontext() as context:
        context.prec = 100000
        return a.quantize(decimal.Decimal(1).scaleb(-places), rounding=decimal.ROUND_HALF_UP)


def decimal_operation(op, digits, args):
    """The result of an operation of Decimal: the first value rounded to the precision, the second one exact"""
    with decimal.localcontext() as context:
        context.prec = digits
        context.rounding = decimal.ROUND_HALF_EVEN
        a = +decimal.Decimal(args[0])
    b = decimal.Decimal(args[1]) if len(args) > 1 else None
    functions = {
        'gamma': mpmath.gamma, 'loggamma': mpmath.loggamma, 'digamma': mpmath.digamma, 'erf': mpmath.erf,
        'erfc': mpmath.erfc, 'zeta': mpmath.zeta, 'lambertw': lambda x: mpmath.lambertw(x).real,
        'exp': mpmath.exp, 'ln': mpmath.ln, 'log10': mpmath.log10, 'sin': mpmath.sin, 'cos': mpmath.cos,
        'tan': mpmath.tan, 'asin': mpmath.asin, 'acos': mpmath.acos, 'atan': mpmath.atan, 'sinh': mpmath.sinh,
        'cosh': mpmath.cosh, 'tanh': mpmath.tanh, 'asinh': mpmath.asinh, 'acosh': mpmath.acosh, 'atanh': mpmath.atanh
    }
    if op == 'round':
        return decimal_result(a, digits)
    if op in ('add', 'sub', 'mul', 'div'):
        return decimal_result(_arithmetic(op, a, b, digits), digits)
    if op == 'mod':
        return decimal_result(remainder(a, b), digits)
    if op == 'pow':
        if b == b.to_integral_value():
            return decimal_result(exact(lambda: a ** b) if b >= 0 else _arithmetic('div', decimal.Decimal(1), exact(lambda: a ** -b), digits), digits)
        return mpmath_result(mpmath.power, digits, a, b)
    if op == 'sqrt':
        with decimal.localcontext() as context:
            context.prec = digits
            context.rounding = decimal.ROUND_HALF_EVEN
            return decimal_result(a.sqrt(), digits)
    if op == 'root':
        n = int(b)
        return mpmath_result(lambda x: mpmath.sign(x) * mpmath.root(abs(x), n), digits, a)
    if op == 'log':
        return mpmath_result(mpmath.log, digits, a, b)
    if op == 'atan2':
        return mpmath_result(mpmath.atan2, digits, a, b)
    if op in functions:
        return mpmath_result(functions[op], digits, a)
    if op in ('floor', 'ceil', 'trunc'):
        rounding = {'floor': decimal.ROUND_FLOOR, 'ceil': decimal.ROUND_CEILING, 'trunc': decimal.ROUND_DOWN}[op]
        return decimal_result(exact(lambda: a.to_integral_value(rounding=rounding)), digits)
    if op == 'roundTo':
        return decimal_result(quantized(a, int(b)), digits)
    if op == 'fixed':
        value = quantized(a, int(b))
        return format(abs(value) if value == 0 else value, 'f')
    raise AssertionError('Unknown operation ' + op)


def _arithmetic(op, a, b, digits):
    """The arithmetic of Python's decimal at a precision: correctly rounded, halves to even"""
    with decimal.localcontext() as context:
        context.prec = digits
        context.rounding = decimal.ROUND_HALF_EVEN
        return {'add': lambda: a + b, 'sub': lambda: a - b, 'mul': lambda: a * b, 'div': lambda: a / b}[op]()


def special():
    """The decimals of the special functions in formulas"""
    save('special', [{**case, 'decimals': {str(digits): decimal_text(parse(case['text']), digits)
                                           for digits in case['decimals']}} for case in load('special')])


def complex_parts():
    """The decimals of complex values, each part from its own evaluation (SymPy's re() and im() of the expression, 30
    more digits, rounded half to even): a part much smaller than the other keeps its digits; an exact 0 is '0'"""
    results = []
    for case in load('complex'):
        expr = parse(case['text'])
        parts = {}
        for digits in case['decimals']:
            texts = []
            for part in (sympy.re(expr), sympy.im(expr)):
                texts.append('0' if part.is_zero else decimal_text(part, digits))
            parts[str(digits)] = texts
        results.append({**case, 'decimals': parts})
    save('complex', results)


def decimals():
    save('decimals', [{**case, 'result': decimal_operation(case['op'], case['precision'], case['args'])}
                      for case in load('decimals')])


if __name__ == '__main__':
    grammar()
    numbers()
    operations('expand', lambda expr, case: sympy.expand(expr))
    operations('diff', lambda expr, case: sympy.diff(expr, Symbol(case['variable']), case.get('times', 1)))
    operations('series', series)
    operations('substitute', substitute)
    solve()
    systems()
    polynomials()
    ntheory()
    continued_fractions()
    matrices()
    decimals()
    special()
    complex_parts()
    print('SymPy', sympy.__version__, 'wrote', ', '.join(sorted(WRITTEN)))
    sys.exit(0)
