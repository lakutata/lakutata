# The expected results of the fixtures, computed by SymPy: for each case of cases/*.json, the result printed in the
# syntax of @lakutata/math and its values at the sample points (30 significant digits), written to expected/*.json.
# Run by generate.sh in a container (python3 and py3-sympy of Alpine), not by the tests.

import decimal
import functools
import json
import math
import os
import sys

import mpmath
import sympy
from sympy import (Abs, E, I, Integer, LambertW, Max, Min, Rational, S, Symbol, ceiling, conjugate, floor, linsolve,
                   log, loggamma, nan, oo, sign, solveset, zoo)
from sympy.core.intfunc import igcdex, mod_inverse
from sympy.functions.combinatorial.factorials import binomial, factorial, factorial2
from sympy.functions.combinatorial.numbers import (bernoulli, fibonacci, harmonic, jacobi_symbol, legendre_symbol, lucas,
                                                   mobius, totient)
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


def save(name, results):
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
    print('SymPy', sympy.__version__, 'wrote', ', '.join(sorted(os.listdir(os.path.join(HERE, 'expected')))))
    sys.exit(0)
