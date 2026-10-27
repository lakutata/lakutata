# The expected results of the numeric solutions (cases/numeric.json): the roots of polynomials by NumPy's roots, the
# roots of functions and of systems by mpmath's findroot at 30 digits, the solutions of overdetermined systems by
# SciPy's least_squares. Written to expected/numeric.json. Run by generate.sh in a container, not by the tests.

import json
import os

import mpmath
import numpy
import scipy
import scipy.optimize
import sympy

from reference import parse

HERE = os.path.dirname(os.path.abspath(__file__))
X = sympy.Symbol('x')


def zero_of(text):
    """The expression equal to 0 of a formula: its difference, of an equation"""
    if '=' in text:
        left, right = text.split('=')
        return parse(left) - parse(right)
    return parse(text)


def polynomial_roots(case):
    if 'coefficients' in case:
        descending = list(reversed(case['coefficients']))
    else:
        polynomial = sympy.Poly(sympy.expand(zero_of(case['polynomial'])), X)
        descending = [complex(c) for c in polynomial.all_coeffs()]
    roots = numpy.roots(numpy.array(descending, dtype=complex))
    roots = sorted(roots, key=lambda z: (round(z.real, 9), round(z.imag, 9)))
    return {'re': [z.real for z in roots], 'im': [z.imag for z in roots]}


def find_root(case):
    f = sympy.lambdify(X, zero_of(case['function']), 'mpmath')
    with mpmath.workdps(30):
        # A bracket of the reference only, where mpmath's secant leaves the guess (atan(x) from 10)
        bracket = case.get('bracket', case.get('referenceBracket'))
        if bracket:
            a, b = bracket
            if mpmath.sign(f(mpmath.mpf(a))) == mpmath.sign(f(mpmath.mpf(b))):
                raise ValueError('no sign change')
            root = mpmath.findroot(f, (mpmath.mpf(a), mpmath.mpf(b)), solver='bisect')
            assert a <= root <= b, case
        else:
            root = mpmath.findroot(f, mpmath.mpf(case['guess']))
        return float(root)


def solve_system(case):
    symbols = [sympy.Symbol(name) for name in case['variables']]
    expressions = [zero_of(text) for text in case['equations']]
    if case.get('leastSquares'):
        functions = sympy.lambdify(symbols, expressions, 'numpy')
        solution = scipy.optimize.least_squares(lambda v: numpy.array(functions(*v), dtype=float), case['guess'], xtol=1e-15, ftol=1e-15, gtol=1e-15)
        return list(solution.x)
    # SciPy's fsolve from the guess, refined by mpmath's Newton at 30 digits (its own steps from the guess may leave it)
    vector = sympy.lambdify(symbols, expressions, 'numpy')
    start = scipy.optimize.fsolve(lambda v: numpy.array(vector(*v), dtype=float), case['guess'], xtol=1e-14)
    functions = [sympy.lambdify(symbols, expression, 'mpmath') for expression in expressions]
    with mpmath.workdps(30):
        solution = mpmath.findroot(functions, [mpmath.mpf(float(v)) for v in start])
        return [float(v) for v in solution]


def generate():
    with open(os.path.join(HERE, 'cases', 'numeric.json')) as file:
        cases = json.load(file)
    operations = {'polynomialRoots': polynomial_roots, 'findRoot': find_root, 'solveSystem': solve_system}
    results = []
    for case in cases:
        result = dict(case)
        if 'error' in case:
            try:
                operations[case['op']](case)
            except (ValueError, sympy.PolynomialError):
                pass
            else:
                raise AssertionError('Python accepts ' + json.dumps(case))
        else:
            result['result'] = operations[case['op']](case)
        results.append(result)
    with open(os.path.join(HERE, 'expected', 'numeric.json'), 'w') as file:
        json.dump({'generator': {'numpy': numpy.__version__, 'scipy': scipy.__version__, 'mpmath': mpmath.__version__}, 'cases': results}, file, allow_nan=False)
        file.write('\n')


if __name__ == '__main__':
    generate()
    print('NumPy', numpy.__version__, 'SciPy', scipy.__version__, 'mpmath', mpmath.__version__, 'wrote numeric.json')
