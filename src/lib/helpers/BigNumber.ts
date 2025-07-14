import BN from 'bn.js'

export type BigNumberEndianness = BN.Endianness

export type BigNumberIPrimeName = BN.IPrimeName

export type BigNumberReductionContext = BN.ReductionContext

export class BigNumber extends BN {
    public static BigNumber: typeof BigNumber = BigNumber
    public static wordSize: 26

    constructor(
        number: bigint | number | string | number[] | Uint8Array | Buffer | BigNumber,
        base?: number | 'hex',
        endian?: BigNumberEndianness
    );
    constructor(
        number: bigint | number | string | number[] | Uint8Array | Buffer | BigNumber,
        endian?: BigNumberEndianness
    );
    constructor(a: any, b?: any, c?: any) {
        super(a, b, c)
    }

    /**
     * create a reduction context
     * @param reductionContext
     */
    public static red(reductionContext: BigNumber | BigNumberIPrimeName): BigNumberReductionContext {
        return super.red(reductionContext)
    }

    /**
     * returns the maximum of 2 BigNumber instances.
     * @param left
     * @param right
     */
    public static max(left: BigNumber, right: BigNumber): BigNumber {
        return super.max(left, right)
    }

    /**
     * returns the minimum of 2 BigNumber instances.
     * @param left
     * @param right
     */
    public static min(left: BigNumber, right: BigNumber): BigNumber {
        return super.min(left, right)
    }

    /**
     * returns true if the supplied object is a BN.js instance
     */
    public static isBigNumber(input: any): input is BigNumber {
        return super.isBN(input)
    }

    /**
     * create a reduction context  with the Montgomery trick.
     * @param num
     */
    public static mont(num: BigNumber): BigNumberReductionContext {
        return super.mont(num)
    }

}