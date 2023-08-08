import 'reflect-metadata'
import CryptoJs from 'crypto-js'
import {createHash, Hash} from 'crypto'
import {ConvertToStream} from './Utilities.js'

/**
 * 异步哈希
 * @param algorithm
 * @param message
 */
function asyncHash(algorithm: string, message: string): Promise<string> {
    return new Promise<string>((resolve, reject): void => {
        const hash: Hash = createHash(algorithm)
        ConvertToStream(message)
            .on('data', chunk => hash.update(chunk))
            .once('error', reject)
            .once('end', () => resolve(hash.digest().toString('hex')))
    })
}

/**
 * 同步哈希
 * @param algorithm
 * @param message
 */
function syncHash(algorithm: string, message: string): string {
    const hash: Hash = createHash(algorithm)
    return hash.update(message).digest().toString('hex')
}

/**
 * 异步MD5哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function MD5(message: string, async: true): Promise<string>
/**
 * 同步MD5哈希算法
 * @param message
 * @constructor
 */
export function MD5(message: string): string
export function MD5(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('MD5', message) : syncHash('MD5', message)
}

/**
 * HmacMD5哈希消息认证码算法
 * @constructor
 */
export function HmacMD5(message: string, key: string): string {
    return CryptoJs.HmacMD5(message, key).toString()
}

/**
 * 异步SHA1哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA1(message: string, async: true): Promise<string>
/**
 * 同步SHA1哈希算法
 * @param message
 * @constructor
 */
export function SHA1(message: string): string
export function SHA1(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('SHA1', message) : syncHash('SHA1', message)
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
 * 异步SHA256哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA256(message: string, async: true): Promise<string>
/**
 * 同步SHA256哈希算法
 * @param message
 * @constructor
 */
export function SHA256(message: string): string
export function SHA256(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('SHA256', message) : syncHash('SHA256', message)
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
 * 异步SHA224哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA224(message: string, async: true): Promise<string>
/**
 * 同步SHA224哈希算法
 * @param message
 * @constructor
 */
export function SHA224(message: string): string
export function SHA224(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('SHA224', message) : syncHash('SHA224', message)
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
 * 异步SHA512哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA512(message: string, async: true): Promise<string>
/**
 * 同步SHA512哈希算法
 * @param message
 * @constructor
 */
export function SHA512(message: string): string
export function SHA512(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('SHA512', message) : syncHash('SHA512', message)
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
 * 异步SHA384哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA384(message: string, async: true): Promise<string>
/**
 * 同步SHA384哈希算法
 * @param message
 * @constructor
 */
export function SHA384(message: string): string
export function SHA384(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('SHA384', message) : syncHash('SHA384', message)
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
 * 异步SHA3哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA3(message: string, async: true): Promise<string>
/**
 * 同步SHA3哈希算法
 * @param message
 * @constructor
 */
export function SHA3(message: string): string
export function SHA3(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('SHA3', message) : syncHash('SHA3', message)
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
 * 异步RIPEMD160哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function RIPEMD160(message: string, async: true): Promise<string>
/**
 * 同步RIPEMD160哈希算法
 * @param message
 * @constructor
 */
export function RIPEMD160(message: string): string
export function RIPEMD160(message: string, async?: boolean): string | Promise<string> {
    return async ? asyncHash('RIPEMD160', message) : syncHash('RIPEMD160', message)
}
