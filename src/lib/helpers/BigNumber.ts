import Bignumber from 'bignumber.js'

function BigNumber() {

}

BigNumber.min = function (...n: any[]): BigNumber {
    return new BigNumber()
}

export {BigNumber}