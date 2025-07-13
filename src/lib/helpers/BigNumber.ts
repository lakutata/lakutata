import BigNumberJs from 'bignumber.js'

export type BigNumberValue = BigNumberJs.Value
export type BigNumberConfig = BigNumberJs.Config
export type BigNumberFormat = BigNumberJs.Format
export type BigNumberInstance = BigNumberJs.Instance
export type BigNumberConstructor = BigNumberJs.Constructor
export type BigNumberModuloMode = BigNumberJs.ModuloMode
export type BigNumberRoundingMode = BigNumberJs.RoundingMode

export class BigNumber extends BigNumberJs {
    constructor(n: BigNumberValue, base?: number) {
        super(n, base)
    }
}