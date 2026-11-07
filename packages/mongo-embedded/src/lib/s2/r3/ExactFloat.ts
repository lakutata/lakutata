// The exact arithmetic of the predicates of s2js, in place of BigFloat32 of bigfloat (vendor/PATCHES.md): a number
// m * 2^e, m a bigint, e an integer. The doubles are such numbers, and their sums, differences and products too, so
// that the results are exact; valueOf rounds to the nearest double.

// The bits of a double: its sign, exponent and fraction
const VIEW = new DataView(new ArrayBuffer(8))

/**
 * 2^exponent times a number, without overflowing or underflowing before the end
 *
 * @param value
 * @param exponent
 */
function scaled(value: number, exponent: number): number {
    while (exponent > 1000) {
        value *= 2 ** 1000
        exponent -= 1000
    }
    while (exponent < -1000) {
        value *= 2 ** -1000
        exponent += 1000
    }
    return value * 2 ** exponent
}

export class ExactFloat {
    readonly mantissa: bigint
    readonly exponent: number

    /**
     * A double (finite), or m * 2^e
     *
     * @param value
     * @param exponent with a bigint: e
     */
    constructor(value: number | bigint, exponent = 0) {
        if (typeof value === 'bigint') {
            this.mantissa = value
            this.exponent = exponent
            return
        }
        if (!Number.isFinite(value)) throw new RangeError(`ExactFloat of ${value}`)
        VIEW.setFloat64(0, value)
        const high = VIEW.getUint32(0)
        const biased = (high >>> 20) & 0x7ff
        const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(VIEW.getUint32(4))
        // A subnormal has no implicit bit, and the exponent of the smallest normal
        const mantissa = biased ? fraction | (1n << 52n) : fraction
        this.mantissa = high >>> 31 ? -mantissa : mantissa
        this.exponent = (biased || 1) - 1075
    }

    /**
     * An ExactFloat of a value
     *
     * @param value
     */
    private static of(value: ExactFloat | number): ExactFloat {
        return value instanceof ExactFloat ? value : new ExactFloat(value)
    }

    add(other: ExactFloat | number): ExactFloat {
        const o = ExactFloat.of(other)
        if (this.exponent >= o.exponent)
            return new ExactFloat((this.mantissa << BigInt(this.exponent - o.exponent)) + o.mantissa, o.exponent)
        return new ExactFloat(this.mantissa + (o.mantissa << BigInt(o.exponent - this.exponent)), this.exponent)
    }

    sub(other: ExactFloat | number): ExactFloat {
        const o = ExactFloat.of(other)
        return this.add(new ExactFloat(-o.mantissa, o.exponent))
    }

    mul(other: ExactFloat | number): ExactFloat {
        const o = ExactFloat.of(other)
        return new ExactFloat(this.mantissa * o.mantissa, this.exponent + o.exponent)
    }

    /**
     * -1, 0 or 1 as this is lower than, equal to or greater than another
     *
     * @param other
     */
    cmp(other: ExactFloat | number): number {
        return this.sub(other).getSign()
    }

    getSign(): number {
        return this.mantissa > 0n ? 1 : this.mantissa < 0n ? -1 : 0
    }

    isZero(): boolean {
        return this.mantissa === 0n
    }

    /**
     * The nearest double: the mantissa cut to 64 bits first, the bits cut off kept as a sticky bit, so that it rounds
     * once
     */
    valueOf(): number {
        let mantissa = this.mantissa < 0n ? -this.mantissa : this.mantissa
        let exponent = this.exponent
        const bits = mantissa.toString(2).length
        if (bits > 64) {
            const shift = BigInt(bits - 64)
            const sticky = mantissa & ((1n << shift) - 1n) ? 1n : 0n
            mantissa = (mantissa >> shift) | sticky
            exponent += bits - 64
        }
        const value = scaled(Number(mantissa), exponent)
        return this.mantissa < 0n ? -value : value
    }

    toString(): string {
        return String(this.valueOf())
    }
}
