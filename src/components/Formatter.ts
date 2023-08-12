import 'reflect-metadata'
import {Component} from '../lib/base/Component.js'
import convert from 'convert-units'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export type Distance = 'mm' | 'cm' | 'm' | 'km' | 'in' | 'ft-us' | 'ft' | 'yd' | 'mi'; // Distance
export type Area = 'mm2' | 'cm2' | 'm2' | 'ha' | 'km2' | 'in2' | 'ft2' | 'ac' | 'mi2'; // Area
export type Mass = 'mcg' | 'mg' | 'g' | 'kg' | 'oz' | 'lb' | 'mt' | 't'; // Mass
export type Volume =
    'mm3'
    | 'cm3'
    | 'ml'
    | 'l'
    | 'kl'
    | 'm3'
    | 'km3'
    | 'tsp'
    | 'Tbs'
    | 'in3'
    | 'fl-oz'
    | 'cup'
    | 'pnt'
    | 'qt'
    | 'gal'
    | 'ft3'
    | 'yd3'; // Volume
export type VolumeFlowRate =
    | 'mm3/s'
    | 'cm3/s'
    | 'ml/s'
    | 'cl/s'
    | 'dl/s'
    | 'l/s'
    | 'l/min'
    | 'l/h'
    | 'kl/s'
    | 'kl/min'
    | 'kl/h'
    | 'm3/s'
    | 'm3/min'
    | 'm3/h'
    | 'km3/s'
    | 'tsp/s'
    | 'Tbs/s'
    | 'in3/s'
    | 'in3/min'
    | 'in3/h'
    | 'fl-oz/s'
    | 'fl-oz/min'
    | 'fl-oz/h'
    | 'cup/s'
    | 'pnt/s'
    | 'pnt/min'
    | 'pnt/h'
    | 'qt/s'
    | 'gal/s'
    | 'gal/min'
    | 'gal/h'
    | 'ft3/s'
    | 'ft3/min'
    | 'ft3/h'
    | 'yd3/s'
    | 'yd3/min'
    | 'yd3/h'; // Volume Flow Rate
export type Temperature = 'C' | 'F' | 'K' | 'R'; // Temperature
export type Frequency = 'Hz' | 'mHz' | 'kHz' | 'MHz' | 'GHz' | 'THz' | 'rpm' | 'deg/s' | 'rad/s'; // Frequency
export type Speed = 'm/s' | 'km/h' | 'm/h' | 'knot' | 'ft/s'; // Speed
export type Pace = 's/m' | 'min/km' | 's/ft' | 'min/mi'; // Pace
export type Pressure = 'Pa' | 'hPa' | 'kPa' | 'MPa' | 'bar' | 'torr' | 'psi' | 'ksi'; // Pressure
export type Digital = 'b' | 'Kb' | 'Mb' | 'Gb' | 'Tb' | 'B' | 'KB' | 'MB' | 'GB' | 'TB'; // Digital
export type PartsPer = 'ppm' | 'ppb' | 'ppt' | 'ppq'; // Parts-Per
export type Voltage = 'V' | 'mV' | 'kV'; // Voltage
export type Current = 'A' | 'mA' | 'kA'; // Current
export type Power = 'W' | 'mW' | 'kW' | 'MW' | 'GW';
export type ApparentPower = 'VA' | 'mVA' | 'kVA' | 'MVA' | 'GVA'; // Apparent Power
export type ReactivePower = 'VAR' | 'mVAR' | 'kVAR' | 'MVAR' | 'GVAR'; // Reactive Power
export type Energy = 'Wh' | 'mWh' | 'kWh' | 'MWh' | 'GWh' | 'J' | 'kJ'; // Energy
export type ReactiveEnergy = 'VARh' | 'mVARh' | 'kVARh' | 'MVARh' | 'GVARH'; // Reactive Energy
export type Angle = 'deg' | 'rad' | 'grad' | 'arcmin' | 'arcsec'; // Angle

export class Formatter extends Component {

    /**
     * 通过移除小数部分将值格式化为整数
     * @param value
     */
    public asInteger(value: number): number
    /**
     * 通过移除小数部分将值格式化为整数
     * @param value
     */
    public asInteger(value: string): number
    @Accept(Validator.Alternatives().try(Validator.Number(), Validator.String()).required())
    public asInteger(value: number | string): number {
        return parseInt(value.toString())
    }

    /**
     * 将数字转换为科学计数法表示
     * @param value
     * @param fractionDigits
     */
    public asScientific(value: number, fractionDigits?: number): string
    /**
     * 将字符串表示的数字转换为科学计数法表示
     * @param value
     * @param fractionDigits
     */
    public asScientific(value: string, fractionDigits?: number): string
    @Accept([Validator.Alternatives().try(Validator.Number(), Validator.String()).required(), Validator.Number().min(1).max(100).optional()])
    public asScientific(value: number | string, fractionDigits?: number): string {
        return parseFloat(value.toString()).toExponential(fractionDigits)
    }

    /**
     * 将值格式化为带有 "%" 符号的百分比数字
     * @param value
     */
    @Accept(Validator.Number().min(-1).max(1).required())
    public asPercent(value: number): string {
        return `${value * 100}%`
    }

    /**
     * 距离单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('mm', 'cm', 'm', 'km', 'in', 'ft-us', 'ft', 'yd', 'mi').required(),
        Validator.String().valid('mm', 'cm', 'm', 'km', 'in', 'ft-us', 'ft', 'yd', 'mi').optional()
    ])
    public asDistance(value: number, toUnit: Distance, fromUnit: Distance = 'mm'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 面积单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('mm2', 'cm2', 'm2', 'ha', 'km2', 'in2', 'ft2', 'ac', 'mi2').required(),
        Validator.String().valid('mm2', 'cm2', 'm2', 'ha', 'km2', 'in2', 'ft2', 'ac', 'mi2').optional()
    ])
    public asArea(value: number, toUnit: Area, fromUnit: Area = 'mm2'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 重量单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('mcg', 'mg', 'g', 'kg', 'oz', 'lb', 'mt', 't').required(),
        Validator.String().valid('mcg', 'mg', 'g', 'kg', 'oz', 'lb', 'mt', 't').optional()
    ])
    public asMass(value: number, toUnit: Mass, fromUnit: Mass = 'g'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 容量单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('mm3', 'cm3', 'ml', 'l', 'kl', 'm3', 'km3', 'tsp', 'Tbs', 'in3', 'fl-oz', 'cup', 'pnt', 'qt', 'gal', 'ft3', 'yd3').required(),
        Validator.String().valid('mm3', 'cm3', 'ml', 'l', 'kl', 'm3', 'km3', 'tsp', 'Tbs', 'in3', 'fl-oz', 'cup', 'pnt', 'qt', 'gal', 'ft3', 'yd3').optional()
    ])
    public asVolume(value: number, toUnit: Volume, fromUnit: Volume = 'mm3'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 流量单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('mm3/s', 'cm3/s', 'ml/s', 'cl/s', 'dl/s', 'l/s', 'l/min', 'l/h', 'kl/s', 'kl/min', 'kl/h', 'm3/s', 'm3/min', 'm3/h', 'km3/s', 'tsp/s', 'Tbs/s', 'in3/s', 'in3/min', 'in3/h', 'fl-oz/s', 'fl-oz/min', 'fl-oz/h', 'cup/s', 'pnt/s', 'pnt/min', 'pnt/h', 'qt/s', 'gal/s', 'gal/min', 'gal/h', 'ft3/s', 'ft3/min', 'ft3/h', 'yd3/s', 'yd3/min', 'yd3/h').required(),
        Validator.String().valid('mm3/s', 'cm3/s', 'ml/s', 'cl/s', 'dl/s', 'l/s', 'l/min', 'l/h', 'kl/s', 'kl/min', 'kl/h', 'm3/s', 'm3/min', 'm3/h', 'km3/s', 'tsp/s', 'Tbs/s', 'in3/s', 'in3/min', 'in3/h', 'fl-oz/s', 'fl-oz/min', 'fl-oz/h', 'cup/s', 'pnt/s', 'pnt/min', 'pnt/h', 'qt/s', 'gal/s', 'gal/min', 'gal/h', 'ft3/s', 'ft3/min', 'ft3/h', 'yd3/s', 'yd3/min', 'yd3/h').optional()
    ])
    public asVolumeFlowRate(value: number, toUnit: VolumeFlowRate, fromUnit: VolumeFlowRate = 'mm3/s'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 温度单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('C', 'F', 'K', 'R').required(),
        Validator.String().valid('C', 'F', 'K', 'R').optional()
    ])
    public asTemperature(value: number, toUnit: Temperature, fromUnit: Temperature = 'C'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 频率单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('Hz', 'mHz', 'kHz', 'MHz', 'GHz', 'THz', 'rpm', 'deg/s', 'rad/s').required(),
        Validator.String().valid('Hz', 'mHz', 'kHz', 'MHz', 'GHz', 'THz', 'rpm', 'deg/s', 'rad/s').optional()
    ])
    public asFrequency(value: number, toUnit: Frequency, fromUnit: Frequency = 'Hz'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 速度单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('m/s', 'km/h', 'm/h', 'knot', 'ft/s').required(),
        Validator.String().valid('m/s', 'km/h', 'm/h', 'knot', 'ft/s').optional()
    ])
    public asSpeed(value: number, toUnit: Speed, fromUnit: Speed = 'm/s'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 速率单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('s/m', 'min/km', 's/ft', 'min/mi').required(),
        Validator.String().valid('s/m', 'min/km', 's/ft', 'min/mi').optional()
    ])
    public asPace(value: number, toUnit: Pace, fromUnit: Pace = 's/m'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 压强单位转换
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('Pa', 'hPa', 'kPa', 'MPa', 'bar', 'torr', 'psi', 'ksi').required(),
        Validator.String().valid('Pa', 'hPa', 'kPa', 'MPa', 'bar', 'torr', 'psi', 'ksi').optional()
    ])
    public asPressure(value: number, toUnit: Pressure, fromUnit: Pressure = 'Pa'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 计算机存储空间单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('b', 'Kb', 'Mb', 'Gb', 'Tb', 'B', 'KB', 'MB', 'GB', 'TB').required(),
        Validator.String().valid('b', 'Kb', 'Mb', 'Gb', 'Tb', 'B', 'KB', 'MB', 'GB', 'TB').optional()
    ])
    public asDigital(value: number, toUnit: Digital, fromUnit: Digital = 'B'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 浓度单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('ppm', 'ppb', 'ppt', 'ppq').required(),
        Validator.String().valid('ppm', 'ppb', 'ppt', 'ppq').optional()
    ])
    public asPartsPer(value: number, toUnit: PartsPer, fromUnit: PartsPer = 'ppm'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 电压单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('V', 'mV', 'kV').required(),
        Validator.String().valid('V', 'mV', 'kV').optional()
    ])
    public asVoltage(value: number, toUnit: Voltage, fromUnit: Voltage = 'V'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 电流单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('A', 'mA', 'kA').required(),
        Validator.String().valid('A', 'mA', 'kA').optional()
    ])
    public asCurrent(value: number, toUnit: Current, fromUnit: Current = 'A'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 功率单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('W', 'mW', 'kW', 'MW', 'GW').required(),
        Validator.String().valid('W', 'mW', 'kW', 'MW', 'GW').optional()
    ])
    public asPower(value: number, toUnit: Power, fromUnit: Power = 'W'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 视在功率单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('VA', 'mVA', 'kVA', 'MVA', 'GVA').required(),
        Validator.String().valid('VA', 'mVA', 'kVA', 'MVA', 'GVA').optional()
    ])
    public asApparentPower(value: number, toUnit: ApparentPower, fromUnit: ApparentPower = 'VA'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 无功功率单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('VAR', 'mVAR', 'kVAR', 'MVAR', 'GVAR').required(),
        Validator.String().valid('VAR', 'mVAR', 'kVAR', 'MVAR', 'GVAR').optional()
    ])
    public asReactivePower(value: number, toUnit: ReactivePower, fromUnit: ReactivePower = 'VAR'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 能量单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('Wh', 'mWh', 'kWh', 'MWh', 'GWh', 'J', 'kJ').required(),
        Validator.String().valid('Wh', 'mWh', 'kWh', 'MWh', 'GWh', 'J', 'kJ').optional()
    ])
    public asEnergy(value: number, toUnit: Energy, fromUnit: Energy = 'Wh'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 无功能量单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('VARh', 'mVARh', 'kVARh', 'MVARh', 'GVARH').required(),
        Validator.String().valid('VARh', 'mVARh', 'kVARh', 'MVARh', 'GVARH').optional()
    ])
    public asReactiveEnergy(value: number, toUnit: ReactiveEnergy, fromUnit: ReactiveEnergy = 'VARh'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }

    /**
     * 角度单位换算
     * @param value
     * @param toUnit
     * @param fromUnit
     */
    @Accept([
        Validator.Number(),
        Validator.String().valid('deg', 'rad', 'grad', 'arcmin', 'arcsec').required(),
        Validator.String().valid('deg', 'rad', 'grad', 'arcmin', 'arcsec').optional()
    ])
    public asAngle(value: number, toUnit: Angle, fromUnit: Angle = 'deg'): number {
        return convert(value).from(fromUnit).to(toUnit)
    }
}
