//The table of the units of @lakutata/math (src/lib/UnitTable.ts): the base quantities, prefixes, units and the system of
//SI units of mathjs 15.2.0 (Apache-2.0, its notice in THIRD_PARTY_NOTICES.md), and the physical constants. The values
//are written exactly: the decimals they print as, mathjs's fractions as fractions, the angles of pi as fractions of pi
//(deg is pi/180, not the double of it); a unit whose value mathjs rounds (psi, hp), or gives of an earlier definition
//(eV), is written by its definition. The constants that the SI defines exactly, and those computed from them, are their exact formulas; the
//measured ones are those of CODATA 2022 (codata.py, of SciPy; mathjs has those of CODATA 2018). Run by import.sh, in a
//container where mathjs is installed (ENGINES is its directory, with codata.json), from the directory of the package.
//The file it writes is committed: the package depends on neither mathjs nor SciPy.
import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'

const engines = process.env.ENGINES
if (!engines) throw new Error('ENGINES is the directory where mathjs is installed')
const require = createRequire(path.join(engines, 'package.json'))
const mathjs = require('mathjs')
const version = require('mathjs/package.json').version
if (version !== '15.2.0') throw new Error(`mathjs 15.2.0 is expected, not ${version}`)
const codata = JSON.parse(readFileSync(path.join(engines, 'codata.json'), 'utf8'))
const math = mathjs.create(mathjs.all)
const Unit = math.Unit

//The units whose value mathjs rounds, or gives of an earlier definition: written by their definitions, in SI units (a
//number) or in units of the table
const DEFINITIONS = {
    //5.02921 m in mathjs: the rod is 5.0292 m
    rd: 'rod',
    sqrd: 'rod^2',
    sqch: 'chain^2',
    //The international acre (4046.86 m^2 in mathjs)
    acre: '43560 sqft',
    acres: '43560 sqft',
    kip: '1000 lbf',
    kips: '1000 lbf',
    //The electronvolt of the SI since 2019 (mathjs: of CODATA 2010)
    eV: '1.602176634e-19',
    electronvolt: '1.602176634e-19',
    electronvolts: '1.602176634e-19',
    //The mechanical horsepower
    hp: '550 ft lbf/s',
    psi: 'lbf/inch^2',
    torr: '101325/760',
    //The conventional millimetre of mercury (133.322 Pa in mathjs)
    mmHg: '133.322387415',
    mmhg: '133.322387415'
}

//A value as an exact formula: a fraction of mathjs, a complex number, a fraction of pi, or the decimal a number prints as
function exact(value, name) {
    if (typeof value === 'object' && value !== null && 'n' in value) return `${value.s < 0 ? '-' : ''}${value.n}/${value.d}`
    //VAR, the reactive volt-ampere, is i VA
    if (typeof value === 'object' && value !== null && 're' in value) {
        if (value.re !== 0) throw new Error(`The value of ${name} is not imaginary: ${value}`)
        return value.im === 1 ? 'i' : `${exact(value.im, name)}*i`
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The value of ${name} is not a number: ${value}`)
    if (value === 0 || Number.isInteger(value * 1e12)) return String(value)
    //A fraction of pi of a denominator up to 648000 (the arc second), found by the continued fraction of value / pi
    const ratio = value / Math.PI
    let [p0, q0, p1, q1] = [0, 1, 1, 0]
    let x = ratio
    for (let k = 0; k < 20 && q1 <= 648000; k++) {
        const a = Math.floor(x)
        ;[p0, p1] = [p1, a * p1 + p0]
        ;[q0, q1] = [q1, a * q1 + q0]
        if (q1 <= 648000 && Math.abs((p1 * Math.PI) / q1 - value) <= 1e-15 * Math.abs(value)) return `${p1 === 1 ? '' : `${p1}*`}pi${q1 === 1 ? '' : `/${q1}`}`
        if (x === a) break
        x = 1 / (x - a)
    }
    return String(value)
}

//The keys of the table: quoted where they are not identifiers
const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`)

const prefixSets = {}
for (const [set, entries] of Object.entries(Unit.PREFIXES)) {
    prefixSets[set] = Object.entries(entries).map(([name, prefix]) => `${key(name)}: ['${exact(prefix.value, `the prefix ${name}`)}', ${prefix.scientific}]`)
}

//The units by their names, in the order of mathjs (a prefixed name is matched with the first unit it ends with)
const quantityOf = (base) => Object.keys(Unit.BASE_UNITS).find((name) => Unit.BASE_UNITS[name] === base)
const prefixSetOf = (prefixes) => Object.keys(Unit.PREFIXES).find((name) => Unit.PREFIXES[name] === prefixes)
const units = []
for (const [name, definition] of Object.entries(Unit.UNITS)) {
    if (definition.name !== name) throw new Error(`${name} is another name of ${definition.name}: not expected`)
    const value = DEFINITIONS[name] ?? exact(definition.value, name)
    units.push(`${key(name)}: {quantity: '${quantityOf(definition.base)}', prefixes: '${prefixSetOf(definition.prefixes)}', value: '${value}', offset: '${exact(definition.offset, `the offset of ${name}`)}'}`)
}
for (const name of Object.keys(DEFINITIONS)) if (!Unit.UNITS[name]) throw new Error(`No unit ${name} to define`)

//The unit of each quantity in the SI (MASS: kg)
const si = Object.entries(Unit.UNIT_SYSTEMS.si).filter(([quantity]) => quantity !== 'NONE').map(([quantity, entry]) => `${quantity}: '${entry.prefix.name}${entry.unit.name}'`)

//The physical constants: [value, unit]. The SI defines c, h, e, k and N_A exactly (and the standard gravity); the other
//exact ones are formulas of them; the measured ones are of CODATA 2022.
const [c, h, e, k, NA] = ['299792458', '6.62607015e-34', '1.602176634e-19', '1.380649e-23', '6.02214076e23']
const measured = (name) => {
    const value = codata.values[name]
    if (!value) throw new Error(`No CODATA value of ${name}`)
    return value
}
const epsilon0 = measured('vacuum electric permittivity')
const constants = {
    speedOfLight: [c, 'm/s'],
    gravitationConstant: [measured('Newtonian constant of gravitation'), 'm^3/(kg s^2)'],
    planckConstant: [h, 'J s'],
    reducedPlanckConstant: [`${h}/(2*pi)`, 'J s'],
    magneticConstant: [measured('vacuum mag. permeability'), 'N/A^2'],
    electricConstant: [epsilon0, 'F/m'],
    vacuumImpedance: [measured('characteristic impedance of vacuum'), 'ohm'],
    coulomb: [`1/(4*pi*${epsilon0})`, 'N m^2/C^2'],
    coulombConstant: [`1/(4*pi*${epsilon0})`, 'N m^2/C^2'],
    elementaryCharge: [e, 'C'],
    bohrMagneton: [measured('Bohr magneton'), 'J/T'],
    conductanceQuantum: [`2*(${e})^2/${h}`, 'S'],
    inverseConductanceQuantum: [`${h}/(2*(${e})^2)`, 'ohm'],
    magneticFluxQuantum: [`${h}/(2*${e})`, 'Wb'],
    nuclearMagneton: [measured('nuclear magneton'), 'J/T'],
    klitzing: [`${h}/(${e})^2`, 'ohm'],
    josephson: [`2*${e}/${h}`, 'Hz/V'],
    bohrRadius: [measured('Bohr radius'), 'm'],
    classicalElectronRadius: [measured('classical electron radius'), 'm'],
    electronMass: [measured('electron mass'), 'kg'],
    fermiCoupling: [measured('Fermi coupling constant'), 'GeV^-2'],
    fineStructure: [measured('fine-structure constant'), ''],
    hartreeEnergy: [measured('Hartree energy'), 'J'],
    protonMass: [measured('proton mass'), 'kg'],
    deuteronMass: [measured('deuteron mass'), 'kg'],
    neutronMass: [measured('neutron mass'), 'kg'],
    quantumOfCirculation: [measured('quantum of circulation'), 'm^2/s'],
    rydberg: [measured('Rydberg constant'), 'm^-1'],
    thomsonCrossSection: [measured('Thomson cross section'), 'm^2'],
    weakMixingAngle: [measured('weak mixing angle'), ''],
    efimovFactor: [measured('Efimov factor'), ''],
    atomicMass: [measured('atomic mass constant'), 'kg'],
    avogadro: [NA, 'mol^-1'],
    boltzmann: [k, 'J/K'],
    faraday: [`${NA}*${e}`, 'C/mol'],
    firstRadiation: [`2*pi*${h}*${c}^2`, 'W m^2'],
    loschmidt: [`101325/(${k}*273.15)`, 'm^-3'],
    gasConstant: [`${NA}*${k}`, 'J/(mol K)'],
    molarPlanckConstant: [`${NA}*${h}`, 'J s/mol'],
    molarVolume: [`${NA}*${k}*273.15/101325`, 'm^3/mol'],
    sackurTetrode: [measured('Sackur-Tetrode constant (1 K, 101.325 kPa)'), ''],
    secondRadiation: [`${h}*${c}/${k}`, 'm K'],
    stefanBoltzmann: [`2*pi^5*(${k})^4/(15*(${h})^3*${c}^2)`, 'W/(m^2 K^4)'],
    wienDisplacement: [measured('Wien wavelength displacement law constant'), 'm K'],
    molarMass: [measured('molar mass constant'), 'kg/mol'],
    molarMassC12: [`12*${measured('molar mass constant')}`, 'kg/mol'],
    gravity: ['9.80665', 'm/s^2'],
    planckLength: [measured('Planck length'), 'm'],
    planckMass: [measured('Planck mass'), 'kg'],
    planckTime: [measured('Planck time'), 's'],
    planckCharge: [`sqrt(2*${epsilon0}*${h}*${c})`, 'C'],
    planckTemperature: [measured('Planck temperature'), 'K']
}
//The constants of mathjs, each one here
const source = readFileSync(path.join(path.dirname(require.resolve('mathjs/package.json')), 'lib', 'esm', 'type', 'unit', 'physicalConstants.js'), 'utf8')
const names = [...source.matchAll(/(?:unit|number)Factory\('(\w+)'/g)].map((match) => match[1])
const missing = names.filter((name) => !constants[name]), extra = Object.keys(constants).filter((name) => !names.includes(name))
if (missing.length || extra.length) throw new Error(`The constants differ from mathjs's: missing ${missing}, extra ${extra}`)

const text = `//Generated by scripts/units/import.sh from mathjs ${version} (Apache-2.0, its notice in THIRD_PARTY_NOTICES.md) and the CODATA
//2022 constants of SciPy ${codata.scipy}: do not edit. Changed from mathjs as scripts/units/import.mjs says: the values are
//exact formulas, the rounded ones replaced by their definitions, the constants of CODATA 2022.

/**
 * The base dimensions, in the order of the dimensions of the quantities
 */
export const DIMENSIONS: readonly string[] = [${Unit.BASE_DIMENSIONS.map((name) => `'${name}'`).join(', ')}]

/**
 * The quantities: their dimensions
 */
export const QUANTITIES: Readonly<Record<string, readonly number[]>> = {
${Object.entries(Unit.BASE_UNITS).map(([name, base]) => `    ${name}: [${base.dimensions.join(', ')}]`).join(',\n')}
}

/**
 * The sets of prefixes: each prefix, its factor and whether it is a power of 1000 (chosen by \`toBest()\`)
 */
export const PREFIXES: Readonly<Record<string, Readonly<Record<string, readonly [string, boolean]>>>> = {
${Object.entries(prefixSets).map(([set, entries]) => `    ${set}: {${entries.length ? `\n        ${entries.join(',\n        ')}\n    ` : ''}}`).join(',\n')}
}

/**
 * A unit: its quantity, its value in the SI unit of its quantity, its offset (the value is of the unit plus its offset),
 * its set of prefixes
 */
export interface UnitDefinition {
    quantity: string
    prefixes: string
    value: string
    offset: string
}

/**
 * The units, by their names, in the order a prefixed name is matched in: the first unit it ends with, of a set of
 * prefixes having the rest
 */
export const UNITS: Readonly<Record<string, UnitDefinition>> = {
    ${units.join(',\n    ')}
}

/**
 * The unit of each quantity in the SI
 */
export const SI: Readonly<Record<string, string>> = {
    ${si.join(',\n    ')}
}

/**
 * The names of the physical constants
 */
export type PhysicalConstant =
${Object.keys(constants).map((name) => `    | '${name}'`).join('\n')}

/**
 * The physical constants: their values and their units
 */
export const CONSTANTS: Readonly<Record<PhysicalConstant, readonly [string, string]>> = {
${Object.entries(constants).map(([name, [value, unit]]) => `    ${name}: ['${value}', '${unit}']`).join(',\n')}
}
`
writeFileSync(path.join('src', 'lib', 'UnitTable.ts'), text)
console.log(`mathjs ${version}, SciPy ${codata.scipy}: ${units.length} units, ${Object.keys(prefixSets).length} sets of prefixes, ${Object.keys(constants).length} constants`)
