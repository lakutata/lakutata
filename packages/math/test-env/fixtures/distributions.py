# The expected values of the probability distributions (cases/distributions.json), computed by SciPy: written to
# expected/distributions.json. scipy_of() is the table of the parameterizations: the distribution of SciPy of each
# distribution of @lakutata/math and its parameters, by their names. Run by generate.sh in a container, not by the
# tests.

import json
import math
import os

import numpy
import scipy
import scipy.stats as st

HERE = os.path.dirname(os.path.abspath(__file__))


def scipy_of(name, p):
    """The frozen distribution of SciPy of ours, the parameters converted"""
    if name == 'normal':
        return st.norm(loc=p.get('mean', 0), scale=p.get('standardDeviation', 1))
    if name == 'lognormal':
        # Of the logarithm's mean mu and standard deviation sigma
        return st.lognorm(s=p.get('logStandardDeviation', 1), scale=math.exp(p.get('logMean', 0)))
    if name == 'uniform':
        lower, upper = p.get('lower', 0), p.get('upper', 1)
        return st.uniform(loc=lower, scale=upper - lower)
    if name == 'exponential':
        return st.expon(scale=1 / p.get('rate', 1))
    if name == 'gamma':
        return st.gamma(a=p['shape'], scale=p.get('scale', 1))
    if name == 'beta':
        return st.beta(a=p['alpha'], b=p['beta'])
    if name == 'chiSquared':
        return st.chi2(df=p['degrees'])
    if name == 'studentT':
        return st.t(df=p['degrees'])
    if name == 'fisherF':
        return st.f(dfn=p['numeratorDegrees'], dfd=p['denominatorDegrees'])
    if name == 'cauchy':
        return st.cauchy(loc=p.get('location', 0), scale=p.get('scale', 1))
    if name == 'laplace':
        return st.laplace(loc=p.get('location', 0), scale=p.get('scale', 1))
    if name == 'logistic':
        return st.logistic(loc=p.get('location', 0), scale=p.get('scale', 1))
    if name == 'weibull':
        return st.weibull_min(c=p['shape'], scale=p.get('scale', 1))
    if name == 'pareto':
        return st.pareto(b=p['shape'], scale=p['scale'])
    if name == 'rayleigh':
        return st.rayleigh(scale=p.get('scale', 1))
    if name == 'triangular':
        lower, mode, upper = p['lower'], p['mode'], p['upper']
        return st.triang(c=(mode - lower) / (upper - lower), loc=lower, scale=upper - lower)
    if name == 'gumbel':
        return st.gumbel_r(loc=p.get('location', 0), scale=p.get('scale', 1))
    if name == 'inverseGamma':
        return st.invgamma(a=p['shape'], scale=p.get('scale', 1))
    if name == 'bernoulli':
        return st.bernoulli(p=p['probability'])
    if name == 'binomial':
        return st.binom(n=p['trials'], p=p['probability'])
    if name == 'poisson':
        return st.poisson(mu=p['mean'])
    if name == 'geometric':
        # The number of trials up to the first success, from 1
        return st.geom(p=p['probability'])
    if name == 'negativeBinomial':
        # The number of failures before the r-th success
        return st.nbinom(n=p['successes'], p=p['probability'])
    if name == 'hypergeometric':
        return st.hypergeom(M=p['total'], n=p['successes'], N=p['draws'])
    raise AssertionError('Unknown distribution ' + name)


def finite(value):
    """A result as JSON: its numbers that are not finite as the strings of JavaScript ('Infinity', 'NaN')"""
    if isinstance(value, numpy.ndarray):
        value = value.tolist()
    if isinstance(value, (list, tuple)):
        return [finite(element) for element in value]
    value = float(value)
    if not math.isfinite(value):
        return 'NaN' if math.isnan(value) else ('Infinity' if value > 0 else '-Infinity')
    return value


def generate():
    with open(os.path.join(HERE, 'cases', 'distributions.json')) as file:
        cases = json.load(file)
    results = []
    for case in cases:
        result = dict(case)
        d = scipy_of(case['distribution'], case['parameters'])
        if 'error' in case:
            # SciPy does not refuse the parameters: its values are NaN
            if not math.isnan(float(d.mean())):
                raise AssertionError('SciPy accepts ' + json.dumps(case))
            results.append(result)
            continue
        discrete = hasattr(d.dist, 'pmf')
        x, p = numpy.array(case['x'], dtype=float), numpy.array(case['p'], dtype=float)
        mean, variance, skewness, kurtosis = d.stats(moments='mvsk')
        result['expected'] = {
            'pdf': finite(d.pmf(x) if discrete else d.pdf(x)),
            'cdf': finite(d.cdf(x)),
            'survival': finite(d.sf(x)),
            'quantile': finite(d.ppf(p)),
            'survivalQuantile': finite(d.isf(p)),
            'mean': finite(mean), 'variance': finite(variance), 'skewness': finite(skewness), 'excessKurtosis': finite(kurtosis),
            'median': finite(d.median()), 'support': finite(d.support())
        }
        results.append(result)
    with open(os.path.join(HERE, 'expected', 'distributions.json'), 'w') as file:
        json.dump({'generator': {'numpy': numpy.__version__, 'scipy': scipy.__version__}, 'cases': results}, file, allow_nan=False)
        file.write('\n')


if __name__ == '__main__':
    generate()
    print('NumPy', numpy.__version__, 'SciPy', scipy.__version__, 'wrote distributions.json')
