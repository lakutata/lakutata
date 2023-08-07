import 'reflect-metadata'
import CryptoJs from 'crypto-js'
import {createHash} from 'crypto'
/**
 * MD5哈希算法
 * @param message
 * @constructor
 */
export function MD5(message: string): string {
    return CryptoJs.MD5(message).toString()
}

/**
 * HmacMD5哈希消息认证码算法
 * @constructor
 */
export function HmacMD5(message: string, key: string): string {
    return CryptoJs.HmacMD5(message, key).toString()
}

/**
 * SHA1哈希算法
 * @param message
 * @constructor
 */
export function SHA1(message: string): string {
    return CryptoJs.SHA1(message).toString()
}

/**
 * HmacSHA1哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA1(message: string, key: string): string {
    return CryptoJs.HmacSHA1(message, key).toString()
}

/**
 * SHA256哈希算法
 * @param message
 * @constructor
 */
export function SHA256(message: string): string {
    return CryptoJs.SHA256(message).toString()
}

/**
 * HmacSHA256哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA256(message: string, key: string): string {
    return CryptoJs.HmacSHA256(message, key).toString()
}

/**
 * SHA224哈希算法
 * @param message
 * @constructor
 */
export function SHA224(message: string): string {
    return CryptoJs.SHA224(message).toString()
}

/**
 * HmacSHA224哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA224(message: string, key: string): string {
    return CryptoJs.HmacSHA224(message, key).toString()
}

/**
 * SHA512哈希算法
 * @param message
 * @constructor
 */
export function SHA512(message: string): string {
    return CryptoJs.SHA512(message).toString()
}

/**
 * HmacSHA512哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA512(message: string, key: string): string {
    return CryptoJs.HmacSHA512(message, key).toString()
}

/**
 * SHA384哈希算法
 * @param message
 * @constructor
 */
export function SHA384(message: string): string {
    return CryptoJs.SHA384(message).toString()
}

/**
 * HmacSHA384哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA384(message: string, key: string): string {
    return CryptoJs.HmacSHA384(message, key).toString()
}

/**
 * SHA3哈希算法
 * @param message
 * @constructor
 */
export function SHA3(message: string): string {
    return CryptoJs.SHA3(message).toString()
}

/**
 * HmacSHA3哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA3(message: string, key: string): string {
    return CryptoJs.HmacSHA3(message, key).toString()
}

/**
 * RIPEMD160哈希算法
 * @param message
 * @constructor
 */
export function RIPEMD160(message: string): string {
    return CryptoJs.RIPEMD160(message).toString()
}
