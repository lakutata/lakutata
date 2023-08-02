import CryptoJs from 'crypto-js'
import {As, SortArray, SortObject} from './Utilities.js'


type InputDataType = any[] | Record<string, any> | boolean | number | bigint | string

export class Crypto {

    /**
     * 对输入数组进行排序
     * @param arr
     * @protected
     */
    protected static arraySorter<T = any>(arr: T[]): T[] {
        return SortArray<T>(arr.map((item: T): T => {
            if (Array.isArray(item)) return As<T>(this.arraySorter<T>(item))
            if (typeof item === 'object') {
                Object.keys(As<any>(item)).forEach((key: string) => As<any>(item)[key] = Array.isArray(As<any>(item)[key]) ? this.arraySorter(As<any>(item)[key]) : As<any>(item)[key])
                SortObject(As<any>(item), {deep: true, order: 'asc'})
            }
            return item
        }), {order: 'asc'})
    }

    /**
     * 对输入对象进行排序
     * @param obj
     * @protected
     */
    protected static objectSorter<T = any>(obj: Record<string, T>): Record<string, T> {
        Object.keys(obj).forEach((key: string): void => {
            if (Array.isArray(obj[key])) {
                As<T>(obj)[key] = this.arraySorter<T>(As<T>(obj)[key])
                return
            }
            if (typeof As<T>(obj)[key] === 'object') {
                As<T>(obj)[key] = this.objectSorter<T>(As<T>(obj)[key])
                return
            }
        })
        return SortObject(obj, {deep: true, order: 'asc'})
    }

    /**
     * 对象转字符串
     * @param obj
     * @protected
     */
    protected static object2String(obj: Record<string, any>): string {
        return JSON.stringify(this.objectSorter(obj))
    }

    /**
     * 数组转字符串
     * @param arr
     * @protected
     */
    protected static array2String(arr: any[]): string {
        return JSON.stringify(this.arraySorter(arr))
    }

    /**
     * 将输入统一化转为字符串
     * @param inp
     * @protected
     */
    protected static unifyInput2String(inp: InputDataType): string {
        switch (typeof inp) {
            case 'number':
                return As<number>(inp).toString()
            case 'object':
                return Array.isArray(inp) ? this.array2String(inp) : this.object2String(inp)
            case 'boolean':
                return (As<boolean>(inp) ? 1 : 0).toString()
            case 'bigint':
                return As<bigint>(inp).toString()
            case 'string':
                return inp
            default:
                return ''
        }
    }

    /**
     * MD5哈希算法
     * @param inp
     * @constructor
     */
    public static MD5(inp: InputDataType): string {
        return CryptoJs.MD5(this.unifyInput2String(inp)).toString()
    }

    /**
     * SHA1哈希算法
     * @param inp
     * @constructor
     */
    public static SHA1(inp: InputDataType): string {
        return CryptoJs.SHA1(this.unifyInput2String(inp)).toString()
    }

    /**
     * SHA256哈希算法
     * @param inp
     * @constructor
     */
    public static SHA256(inp: InputDataType): string {
        return CryptoJs.SHA256(this.unifyInput2String(inp)).toString()
    }

    /**
     * SHA224哈希算法
     * @param inp
     * @constructor
     */
    public static SHA224(inp: InputDataType): string {
        return CryptoJs.SHA224(this.unifyInput2String(inp)).toString()
    }

    /**
     * SHA512哈希算法
     * @param inp
     * @constructor
     */
    public static SHA512(inp: InputDataType): string {
        return CryptoJs.SHA512(this.unifyInput2String(inp)).toString()
    }

    /**
     * SHA384哈希算法
     * @param inp
     * @constructor
     */
    public static SHA384(inp: InputDataType): string {
        return CryptoJs.SHA384(this.unifyInput2String(inp)).toString()
    }

    /**
     * SHA3哈希算法
     * @param inp
     * @constructor
     */
    public static SHA3(inp: InputDataType): string {
        return CryptoJs.SHA3(this.unifyInput2String(inp)).toString()
    }

    /**
     * RIPEMD160哈希算法
     * @param inp
     * @constructor
     */
    public static RIPEMD160(inp: InputDataType): string {
        return CryptoJs.RIPEMD160(this.unifyInput2String(inp)).toString()
    }
}
