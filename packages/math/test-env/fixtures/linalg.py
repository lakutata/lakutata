# The expected results of the numeric linear algebra (cases/linalg.json), computed by NumPy and SciPy: written to
# expected/linalg.json. Run by generate.sh in a container (py3-numpy and py3-scipy of Alpine), not by the tests.

import json
import os

import numpy
import scipy
import scipy.linalg

HERE = os.path.dirname(os.path.abspath(__file__))


def array(value):
    return numpy.array(value, dtype=float)


def plain(value):
    """A result as JSON: numbers, or nested lists of numbers"""
    if isinstance(value, numpy.ndarray):
        return value.tolist()
    return float(value) if not isinstance(value, (int, numpy.integer)) else int(value)


def norm_kind(kind):
    return numpy.inf if kind == 'inf' else kind


def compute(case):
    a = [array(value) for value in case['args']]
    op = case['op']
    if op == 'multiply':
        return a[0] @ a[1]
    if op == 'solve':
        return numpy.linalg.solve(a[0], a[1])
    if op == 'solveTriangular':
        return scipy.linalg.solve_triangular(a[0], a[1], lower=case['triangle'] == 'lower')
    if op == 'leastSquares':
        # The minimum-norm solution, by the singular values above max(m, n) eps of the largest (rcond=None)
        return numpy.linalg.lstsq(a[0], a[1], rcond=None)[0]
    if op == 'inverse':
        return numpy.linalg.inv(a[0])
    if op == 'determinant':
        return numpy.linalg.det(a[0])
    if op == 'rank':
        return numpy.linalg.matrix_rank(a[0], tol=case.get('tolerance'))
    if op == 'singularValues':
        return numpy.linalg.svd(a[0], compute_uv=False)
    if op == 'condition':
        return numpy.linalg.cond(a[0])
    if op == 'norm':
        return numpy.linalg.norm(a[0], norm_kind(case['kind']))
    # The decompositions are not unique (signs, the order of eigenvalues): their invariants, the tests check the rest
    # (reconstructions, triangles, orthonormal columns)
    if op == 'lu':
        return numpy.linalg.det(a[0])
    if op == 'qr':
        return numpy.abs(numpy.diag(numpy.linalg.qr(a[0], mode='reduced')[1]))
    if op == 'cholesky':
        return numpy.linalg.cholesky(a[0])
    if op == 'svd':
        return numpy.linalg.svd(a[0], compute_uv=False)
    if op in ('eigen', 'schur'):
        values = sorted(numpy.linalg.eigvals(a[0]), key=lambda value: (round(value.real, 9), value.imag))
        return numpy.array([[value.real, value.imag] for value in values])
    if op == 'symmetricEigen':
        return numpy.linalg.eigvalsh(a[0])
    if op == 'pseudoInverse':
        return numpy.linalg.pinv(a[0])
    raise AssertionError('Unknown operation ' + op)


def linalg():
    with open(os.path.join(HERE, 'cases', 'linalg.json')) as file:
        cases = json.load(file)
    results = []
    for case in cases:
        result = dict(case)
        if 'error' in case:
            try:
                compute(case)
            except numpy.linalg.LinAlgError:
                pass
            else:
                raise AssertionError('NumPy accepts ' + json.dumps(case))
        else:
            result['result'] = plain(compute(case))
        results.append(result)
    with open(os.path.join(HERE, 'expected', 'linalg.json'), 'w') as file:
        json.dump({'generator': {'numpy': numpy.__version__, 'scipy': scipy.__version__}, 'cases': results}, file)
        file.write('\n')


if __name__ == '__main__':
    linalg()
    print('NumPy', numpy.__version__, 'SciPy', scipy.__version__, 'wrote linalg.json')
