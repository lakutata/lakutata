# The conversions and the physical constants of SymPy's physics.units for the cases of units (cases/units.json): a
# value converted to other units, a constant in the base units of the SI, each as 30 digits, exact or not (a Float in
# SymPy's value). Written to expected/units.json; engines.mjs adds mathjs's results.
import json
import os

import sympy
import sympy.physics.units as units

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = {name: getattr(units, name) for name in dir(units) if not name.startswith('_')}
BASE = [units.kilogram, units.meter, units.second, units.ampere, units.kelvin, units.mole, units.candela]


def result(value):
    value = sympy.nsimplify(value) if not value.has(sympy.Float) else value
    if value.free_symbols or value.atoms(units.Quantity):
        raise ValueError('not a number: %s' % value)
    return {'value': str(sympy.N(value, 30)), 'exact': not value.has(sympy.Float)}


def convert(case):
    value = sympy.sympify(case['sympy'][0], locals=NAMES)
    target = sympy.sympify(case['sympy'][1], locals=NAMES)
    return result(sympy.simplify(units.convert_to(value, target) / target))


def constant(case):
    value = units.convert_to(NAMES[case['sympy']], BASE)
    return result(value.subs({unit: 1 for unit in BASE}))


def main():
    with open(os.path.join(HERE, 'cases', 'units.json')) as file:
        cases = json.load(file)['cases']
    results = []
    for case in cases:
        if 'sympy' not in case:
            results.append({})
        elif case['op'] == 'convert':
            results.append({'sympy': convert(case)})
        else:
            results.append({'sympy': constant(case)})
    with open(os.path.join(HERE, 'expected', 'units.json'), 'w') as file:
        json.dump({'sympy': sympy.__version__, 'cases': results}, file, indent=1)
        file.write('\n')


main()
