# The measured physical constants of the table of the units: CODATA 2022, as SciPy (1.15 and later) gives them, by
# their CODATA names; and Efimov's factor exp(pi/s0), s0 the root of s0 cosh(pi s0/2) = 8/sqrt(3) sinh(pi s0/6), to 25
# digits (mpmath). Run by import.sh; it prints them as JSON.
import json

import mpmath
import scipy
import scipy.constants

NAMES = [
    'Newtonian constant of gravitation', 'vacuum mag. permeability', 'vacuum electric permittivity',
    'characteristic impedance of vacuum', 'Bohr magneton', 'nuclear magneton', 'Bohr radius',
    'classical electron radius', 'electron mass', 'Fermi coupling constant', 'fine-structure constant',
    'Hartree energy', 'proton mass', 'deuteron mass', 'neutron mass', 'quantum of circulation', 'Rydberg constant',
    'Thomson cross section', 'weak mixing angle', 'atomic mass constant', 'molar mass constant', 'Planck length',
    'Planck mass', 'Planck time', 'Planck temperature', 'Sackur-Tetrode constant (1 K, 101.325 kPa)',
    'Wien wavelength displacement law constant'
]
constants = scipy.constants.physical_constants
# CODATA 2022: its electron mass
if constants['electron mass'][0] != 9.1093837139e-31:
    raise SystemExit('SciPy does not give CODATA 2022 (SciPy %s)' % scipy.__version__)
values = {name: repr(constants[name][0]) for name in NAMES}
mpmath.mp.dps = 40
s0 = mpmath.findroot(lambda s: s * mpmath.cosh(mpmath.pi * s / 2) - 8 / mpmath.sqrt(3) * mpmath.sinh(mpmath.pi * s / 6), 1)
values['Efimov factor'] = mpmath.nstr(mpmath.exp(mpmath.pi / s0), 25)
print(json.dumps({'scipy': scipy.__version__, 'values': values}))
