# The expected results of the numeric solutions (cases/numeric.json): the roots of polynomials by NumPy's roots, the
# roots of functions and of systems by mpmath's findroot at 30 digits, the solutions of overdetermined systems by
# SciPy's least_squares, the integrals by mpmath's quad at 30 digits (SciPy's quad compared with it, its differences
# noted). Written to expected/numeric.json. Run by generate.sh in a container, not by the tests.

import json
import os

import mpmath
import numpy
import scipy
import scipy.integrate
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


def end_of(value, infinity):
    """An end of an interval: a number, or 'inf' and '-inf' (JSON has no infinity)"""
    if value == 'inf':
        return infinity
    if value == '-inf':
        return -infinity
    return value


def checked_quad(f, nodes):
    """mpmath's quad, of degrees higher until its own error estimate is below 1e-18 (x^-0.9 at its default degree is
    9.996, not 10)"""
    for degree in (8, 10, 12):
        value, error = mpmath.quad(f, nodes, error=True, maxdegree=degree)
        if isinstance(value, mpmath.mpc) and abs(value.imag) > mpmath.mpf(10) ** -20 * max(1, abs(value.real)):
            raise ValueError('not real')
        if error <= mpmath.mpf(10) ** -18 * max(1, abs(value)):
            return value
    raise RuntimeError('mpmath quad does not converge: error %s, value %s' % (error, value))


def integrate(case):
    """mpmath's quad at 30 digits, the interval split at the points (and at the points of the reference only, where
    its tanh-sinh needs them: a narrow peak; or in equal parts, of an oscillating function), at more digits where its
    nodes must come closer to a singular end (x^-0.9 has 0.004 of its integral below 10^-30); not real or not finite
    is an error. SciPy's quad is compared with it, or is the reference where mpmath would need thousands of digits
    (x^-0.99 has 1e-16 of its integral below 10^-1600: QUADPACK extrapolates it). A case that does not converge in
    doubles has no reference."""
    if case.get('notConverged'):
        return {}
    if case.get('reference') == 'scipy':
        g = sympy.lambdify(X, parse(case['function']), 'numpy')
        a, b = (end_of(e, numpy.inf) for e in case['interval'])
        value, error = scipy.integrate.quad(lambda x: float(g(x)), a, b, epsabs=0, epsrel=1e-13, limit=200)
        if not error <= 1e-12 * abs(value):
            raise RuntimeError('%s: SciPy quad does not converge: error %r' % (case['function'], error))
        return {'value': value}
    expression = parse(case['function'])
    f = sympy.lambdify(X, expression, 'mpmath')
    ends = [case['interval'][0]] + sorted(case.get('points', []) + case.get('referencePoints', [])) + [case['interval'][1]]
    with mpmath.workdps(case.get('referenceDigits', 30)):
        # The ends and the points as the decimals they print as (0.3 is 3/10, as in the formulas), at the working digits
        nodes = [end_of(mpmath.mpf(repr(e)) if not isinstance(e, str) else e, mpmath.inf) for e in ends]
        if nodes[0] > nodes[-1]:
            nodes = list(reversed(nodes))
            sign = -1
        else:
            sign = 1
        parts = case.get('referenceSplit', 1)
        nodes = [nodes[0]] + [node for i in range(len(nodes) - 1) for node in [nodes[i] + (nodes[i + 1] - nodes[i]) * k / parts for k in range(1, parts)] + [nodes[i + 1]]]
        try:
            value = sign * checked_quad(f, nodes)
        except RuntimeError as failure:
            raise RuntimeError('%s: %s' % (case['function'], failure))
        if isinstance(value, mpmath.mpc):
            if abs(value.imag) > mpmath.mpf(10) ** -20 * max(1, abs(value.real)):
                raise ValueError('not real')
            value = value.real
        if not mpmath.isfinite(value):
            raise ValueError('not finite')
        reference = float(value)
    g = sympy.lambdify(X, expression, 'numpy')
    a, b = (end_of(e, numpy.inf) for e in case['interval'])
    inside = [p for p in case.get('points', []) if min(a, b) < p < max(a, b)]
    with numpy.errstate(all='ignore'):
        scipy_value = scipy.integrate.quad(lambda x: float(g(x)), a, b, points=inside or None, limit=200)[0] if not inside or (numpy.isfinite(a) and numpy.isfinite(b)) else None
    result = {'value': reference}
    if scipy_value is not None and not abs(scipy_value - reference) <= 1e-8 * max(1, abs(reference)):
        result['differs'] = 'SciPy quad gives %r' % scipy_value
    return result


def generate():
    with open(os.path.join(HERE, 'cases', 'numeric.json')) as file:
        cases = json.load(file)
    operations = {'polynomialRoots': polynomial_roots, 'findRoot': find_root, 'solveSystem': solve_system, 'integrate': integrate}
    results = []
    for case in cases:
        result = dict(case)
        if 'error' in case:
            try:
                operations[case['op']](case)
            except (ValueError, ZeroDivisionError, sympy.PolynomialError):
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
