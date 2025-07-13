import Instance from 'bignumber.js'
import * as util from 'node:util'

function BigNumber(n: string | number | bigint | Instance, base?: number): BigNumber {
    return new Instance(n, base)
}

util.inherits(BigNumber, Instance)
export {BigNumber}