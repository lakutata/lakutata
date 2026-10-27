# The expected results of the statistics (cases/stats.json): exact where Python computes them exactly (math.fsum, the
# fractions of the variances and covariances, statistics.median), NumPy's linear quantiles, SciPy's z-scores, median
# absolute deviations and entropies. Written to expected/stats.json. Run by generate.sh in a container, not by the
# tests.

import json
import math
import os
import statistics
from fractions import Fraction

import numpy
import scipy
import scipy.stats

HERE = os.path.dirname(os.path.abspath(__file__))
DIVISORS = {'uncorrected': 0, 'unbiased': -1, 'biased': 1}


def deviations(x, y):
    """The exact sum of the products of the deviations from the exact means"""
    mx = sum(Fraction(v) for v in x) / len(x)
    my = sum(Fraction(v) for v in y) / len(y)
    return sum((Fraction(a) - mx) * (Fraction(b) - my) for a, b in zip(x, y))


def divided(total, n, normalization):
    divisor = n + DIVISORS[normalization]
    return float(total / divisor) if divisor else math.nan


def compute(case):
    op = case['op']
    a = case['args']
    x = a[0]
    if op == 'sum':
        return math.fsum(x)
    if op == 'product':
        return math.prod(x)
    if op == 'cumulativeSum':
        return [math.fsum(x[:i + 1]) for i in range(len(x))]
    if op == 'differences':
        return numpy.diff(numpy.array(x, dtype=float)).tolist()
    if op in ('mean', 'median', 'quantile', 'medianAbsoluteDeviation') and not x:
        raise ValueError('empty')
    if op == 'mean':
        return float(sum(Fraction(v) for v in x) / len(x))
    if op == 'median':
        return statistics.median(x)
    if op == 'mode':
        return sorted(statistics.multimode(x))
    if op == 'min':
        return min(x)
    if op == 'max':
        return max(x)
    if op == 'variance':
        return divided(deviations(x, x), len(x), case['normalization'])
    if op == 'standardDeviation':
        return math.sqrt(divided(deviations(x, x), len(x), case['normalization']))
    if op == 'medianAbsoluteDeviation':
        return float(scipy.stats.median_abs_deviation(x))
    if op == 'quantile':
        if any(p < 0 or p > 1 for p in a[1]):
            raise ValueError('probability')
        return numpy.quantile(numpy.array(x, dtype=float), a[1]).tolist()
    if op == 'covariance':
        if len(x) != len(a[1]):
            raise ValueError('lengths')
        return divided(deviations(x, a[1]), len(x), case['normalization'])
    if op == 'correlation':
        sxy, sxx, syy = deviations(x, a[1]), deviations(x, x), deviations(a[1], a[1])
        return float(sxy) / math.sqrt(float(sxx * syy))
    if op == 'zScores':
        return scipy.stats.zscore(numpy.array(x, dtype=float), ddof=-DIVISORS[case['normalization']]).tolist()
    if op == 'klDivergence':
        if any(v < 0 for v in x + a[1]):
            raise ValueError('negative')
        return float(scipy.stats.entropy(x, a[1]))
    raise AssertionError('Unknown operation ' + op)


def finite(value):
    """A result as JSON: its numbers that are not finite as the strings of JavaScript ('Infinity', 'NaN')"""
    if isinstance(value, list):
        return [finite(element) for element in value]
    if isinstance(value, float) and not math.isfinite(value):
        return 'NaN' if math.isnan(value) else ('Infinity' if value > 0 else '-Infinity')
    return value


def generate():
    with open(os.path.join(HERE, 'cases', 'stats.json')) as file:
        cases = json.load(file)
    results = []
    for case in cases:
        result = dict(case)
        if 'error' in case:
            try:
                compute(case)
            except ValueError:
                pass
            else:
                raise AssertionError('Python accepts ' + json.dumps(case))
        else:
            result['result'] = finite(compute(case))
        results.append(result)
    with open(os.path.join(HERE, 'expected', 'stats.json'), 'w') as file:
        json.dump({'generator': {'numpy': numpy.__version__, 'scipy': scipy.__version__}, 'cases': results}, file, allow_nan=False)
        file.write('\n')


if __name__ == '__main__':
    generate()
    print('NumPy', numpy.__version__, 'SciPy', scipy.__version__, 'wrote stats.json')
