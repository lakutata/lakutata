import 'reflect-metadata'
import CryptoJs from 'crypto-js'
import {createHash, createHmac, Hash, Hmac, getHashes} from 'crypto'
import {ConvertToStream} from './Utilities.js'
import {NotSupportHashException} from './exceptions/NotSupportHashException.js'
import {Readable as ReadableStream} from 'stream'

/**
 * 系统所支持的哈希算法
 */
const SUPPORT_HASHES: string[] = getHashes().map((value: string) => value.toUpperCase())

/**
 * 数据缓冲区阈值
 */
const HIGH_WATER_MARK: number = 16384

/**
 * 哈希兼容性处理
 * @param algorithm
 * @param message
 */
function hashFallback(algorithm: string, message: string): string {
    const parts: string[] = algorithm.split('-')
    const mainAlgorithm: string = parts[0]
    switch (mainAlgorithm) {
        case 'MD5':
            return CryptoJs.MD5(message).toString()
        case 'SHA1':
            return CryptoJs.SHA1(message).toString()
        case 'SHA256':
            return CryptoJs.SHA256(message).toString()
        case 'SHA224':
            return CryptoJs.SHA224(message).toString()
        case 'SHA512':
            return CryptoJs.SHA512(message).toString()
        case 'SHA384':
            return CryptoJs.SHA384(message).toString()
        case 'RIPEMD160':
            return CryptoJs.RIPEMD160(message).toString()
        case 'SHA3':
            return CryptoJs.SHA3(message, {outputLength: parseInt(parts[1])}).toString()
        case 'SM3':
            return ''//todo 实现SM3的兼容性处理
        default:
            throw new NotSupportHashException('Algorithm "{0}" is not supported', [algorithm])
    }
}

/**
 * 哈希消息认证码兼容性处理
 * @param algorithm
 * @param message
 * @param key
 */
function hmacFallback(algorithm: string, message: string, key: string): string {
    const parts: string[] = algorithm.split('-')
    const mainAlgorithm: string = parts[0]
    switch (mainAlgorithm) {
        case 'MD5':
            return CryptoJs.HmacMD5(message, key).toString()
        case 'SHA1':
            return CryptoJs.HmacSHA1(message, key).toString()
        case 'SHA256':
            return CryptoJs.HmacSHA256(message, key).toString()
        case 'SHA224':
            return CryptoJs.HmacSHA224(message, key).toString()
        case 'SHA512':
            return CryptoJs.HmacSHA512(message, key).toString()
        case 'SHA384':
            return CryptoJs.HmacSHA384(message, key).toString()
        case 'RIPEMD160':
            return CryptoJs.HmacRIPEMD160(message, key).toString()
        case 'SHA3':
            return CryptoJs.HmacSHA3(message, key).toString()
        case 'SM3':
            return ''//todo 实现SM3的兼容性处理
        default:
            throw new NotSupportHashException('Algorithm "{0}" is not supported', [algorithm])
    }
}

/**
 * 异步哈希计算
 * @param algorithm
 * @param message
 */
function asyncHash(algorithm: string, message: string): Promise<string> {
    return new Promise<string>((resolve, reject): void => {
        if (SUPPORT_HASHES.includes(algorithm)) {
            try {
                const hash: Hash = createHash(algorithm)
                ConvertToStream(message, {highWaterMark: HIGH_WATER_MARK})
                    .on('data', chunk => hash.update(chunk))
                    .once('error', reject)
                    .once('end', () => resolve(hash.digest().toString('hex')))
            } catch (e) {
                return reject(new NotSupportHashException(<Error>e))
            }
        } else {
            try {
                return resolve(hashFallback(algorithm, message))
            } catch (e) {
                return reject(e)
            }
        }
    })
}

/**
 * 同步哈希计算
 * @param algorithm
 * @param message
 */
function syncHash(algorithm: string, message: string): string {
    if (SUPPORT_HASHES.includes(algorithm)) {
        try {
            const hash: Hash = createHash(algorithm)
            return hash.update(message).digest().toString('hex')
        } catch (e) {
            throw new NotSupportHashException(<Error>e)
        }
    } else {
        try {
            return hashFallback(algorithm, message)
        } catch (e) {
            throw e
        }
    }
}

/**
 * 异步哈希消息认证码计算
 * @param algorithm
 * @param message
 * @param key
 */
function asyncHmacHash(algorithm: string, message: string, key: string): Promise<string> {
    return new Promise<string>((resolve, reject): void => {
        if (SUPPORT_HASHES.includes(algorithm)) {
            try {
                const hmac: Hmac = createHmac(algorithm, key)
                ConvertToStream(message, {highWaterMark: HIGH_WATER_MARK})
                    .on('data', chunk => hmac.update(chunk))
                    .once('error', reject)
                    .once('end', () => resolve(hmac.digest().toString('hex')))
            } catch (e) {
                return reject(new NotSupportHashException(<Error>e))
            }
        } else {
            try {
                return resolve(hmacFallback(algorithm, message, key))
            } catch (e) {
                return reject(e)
            }
        }
    })
}

/**
 * 同步哈希消息认证码计算
 * @param algorithm
 * @param message
 * @param key
 */
function syncHmacHash(algorithm: string, message: string, key: string): string {
    if (SUPPORT_HASHES.includes(algorithm)) {
        try {
            const hmac: Hmac = createHmac(algorithm, key)
            return hmac.update(message).digest().toString('hex')
        } catch (e) {
            throw new NotSupportHashException(<Error>e)
        }
    } else {
        try {
            return hmacFallback(algorithm, message, key)
        } catch (e) {
            throw e
        }
    }

}

/**
 * 从读取流计算哈希值
 * @param algorithm
 * @param readable
 */
function readableStreamHash(algorithm: string, readable: ReadableStream): Promise<string> {
    return new Promise<string>((resolve, reject): void => {
        try {
            const hash: Hash = createHash(algorithm)
            readable.on('data', chunk => hash.update(chunk))
                .once('error', reject)
                .once('end', () => resolve(hash.digest().toString('hex')))
        } catch (e) {
            return reject(new NotSupportHashException(<Error>e))
        }
    })
}

/**
 * 从读取流计算哈希消息认证码
 * @param algorithm
 * @param readable
 * @param key
 */
function readableStreamHmacHash(algorithm: string, readable: ReadableStream, key: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        try {
            const hmac: Hmac = createHmac(algorithm, key)
            readable.on('data', chunk => hmac.update(chunk))
                .once('error', reject)
                .once('end', () => resolve(hmac.digest().toString('hex')))
        } catch (e) {
            return reject(new NotSupportHashException(<Error>e))
        }
    })
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
export function MD5(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('MD5', message) : syncHash('MD5', message)
}

/**
 * 异步HmacMD5哈希消息认证码算法
 * @constructor
 */
export async function HmacMD5(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacMD5哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacMD5(message: string, key: string): string
export function HmacMD5(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('MD5', message, key) : syncHmacHash('MD5', message, key)
}

/**
 * 读取流内容的MD5哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamMD5(readable: ReadableStream): Promise<string> {
    return readableStreamHash('MD5', readable)
}

/**
 * 读取流内容HmacMD5哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacMD5(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('MD5', readable, key)
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
export function SHA1(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA1', message) : syncHash('SHA1', message)
}

/**
 * 异步HmacSHA1哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA1(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA1哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA1(message: string, key: string): string
export function HmacSHA1(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA1', message, key) : syncHmacHash('SHA1', message, key)
}

/**
 * 读取流内容的SHA1哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA1(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA1', readable)
}

/**
 * 读取流内容HmacSHA1哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA1(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA1', readable, key)
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
export function SHA256(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA256', message) : syncHash('SHA256', message)
}

/**
 * 异步HmacSHA256哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA256(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA256哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA256(message: string, key: string): string
export function HmacSHA256(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA256', message, key) : syncHmacHash('SHA256', message, key)
}

/**
 * 读取流内容的SHA256哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA256(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA256', readable)
}

/**
 * 读取流内容HmacSHA256哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA256(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA256', readable, key)
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
export function SHA224(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA224', message) : syncHash('SHA224', message)
}

/**
 * 异步HmacSHA224哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA224(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA224哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA224(message: string, key: string): string
export function HmacSHA224(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA224', message, key) : syncHmacHash('SHA224', message, key)
}

/**
 * 读取流内容的SHA224哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA224(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA224', readable)
}

/**
 * 读取流内容HmacSHA224哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA224(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA224', readable, key)
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
export function SHA512(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA512', message) : syncHash('SHA512', message)
}

/**
 * 异步HmacSHA512哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA512(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA512哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA512(message: string, key: string): string
export function HmacSHA512(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA512', message, key) : syncHmacHash('SHA512', message, key)
}

/**
 * 读取流内容的SHA512哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA512(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA512', readable)
}

/**
 * 读取流内容HmacSHA512哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA512(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA512', readable, key)
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
export function SHA384(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA384', message) : syncHash('SHA384', message)
}

/**
 * 异步HmacSHA384哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA384(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA384哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA384(message: string, key: string): string
export function HmacSHA384(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA384', message, key) : syncHmacHash('SHA384', message, key)
}

/**
 * 读取流内容的SHA384哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA384(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA384', readable)
}

/**
 * 读取流内容HmacSHA384哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA384(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA384', readable, key)
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
export function SHA3(message: string, async?: true): string | Promise<string> {
    return async ? SHA3_512(message, true) : SHA3_512(message)
}

/**
 * 异步HmacSHA3哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA3(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA3哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA3(message: string, key: string): string
export function HmacSHA3(message: string, key: string, async?: true): string | Promise<string> {
    return async ? HmacSHA3_512(message, key, true) : HmacSHA3_512(message, key)
}

/**
 * 读取流内容的SHA3哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA3(readable: ReadableStream): Promise<string> {
    return StreamSHA3_512(readable)
}

/**
 * 读取流内容HmacSHA3哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA3(readable: ReadableStream, key: string): Promise<string> {
    return StreamHmacSHA3_512(readable, key)
}

/**
 * 异步SHA3_224哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA3_224(message: string, async: true): Promise<string>
/**
 * 同步SHA3哈希算法
 * @param message
 * @constructor
 */
export function SHA3_224(message: string): string
export function SHA3_224(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA3-224', message) : syncHash('SHA3-224', message)
}

/**
 * 异步HmacSHA3_224哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA3_224(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA3_224哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA3_224(message: string, key: string): string
export function HmacSHA3_224(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA3-224', message, key) : syncHmacHash('SHA3-224', message, key)
}

/**
 * 读取流内容的SHA3_224哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA3_224(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA3-224', readable)
}

/**
 * 读取流内容HmacSHA3_224哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA3_224(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA3_-24', readable, key)
}

/**
 * 异步SHA3_256哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA3_256(message: string, async: true): Promise<string>
/**
 * 同步SHA3_256哈希算法
 * @param message
 * @constructor
 */
export function SHA3_256(message: string): string
export function SHA3_256(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA3-256', message) : syncHash('SHA3-256', message)
}

/**
 * 异步HmacSHA3_256哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA3_256(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA3_256哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA3_256(message: string, key: string): string
export function HmacSHA3_256(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA3-256', message, key) : syncHmacHash('SHA3-256', message, key)
}

/**
 * 读取流内容的SHA3_256哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA3_256(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA3-256', readable)
}

/**
 * 读取流内容HmacSHA3_256哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA3_256(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA3-256', readable, key)
}

/**
 * 异步SHA3_384哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA3_384(message: string, async: true): Promise<string>
/**
 * 同步SHA3_384哈希算法
 * @param message
 * @constructor
 */
export function SHA3_384(message: string): string
export function SHA3_384(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA3-384', message) : syncHash('SHA3-384', message)
}

/**
 * 异步HmacSHA3_384哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA3_384(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA3_384哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA3_384(message: string, key: string): string
export function HmacSHA3_384(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA3-384', message, key) : syncHmacHash('SHA3-384', message, key)
}

/**
 * 读取流内容的SHA3_384哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA3_384(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA3-384', readable)
}

/**
 * 读取流内容HmacSHA3_384哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA3_384(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA3-384', readable, key)
}

/**
 * 异步SHA3_512哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SHA3_512(message: string, async: true): Promise<string>
/**
 * 同步SHA3_512哈希算法
 * @param message
 * @constructor
 */
export function SHA3_512(message: string): string
export function SHA3_512(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SHA3-512', message) : syncHash('SHA3-512', message)
}

/**
 * 异步HmacSHA3_512哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSHA3_512(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSHA3_512哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSHA3_512(message: string, key: string): string
export function HmacSHA3_512(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SHA3-512', message, key) : syncHmacHash('SHA3-512', message, key)
}

/**
 * 读取流内容的SHA3_512哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSHA3_512(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SHA3-512', readable)
}

/**
 * 读取流内容HmacSHA3_512哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSHA3_512(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SHA3-512', readable, key)
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
export function RIPEMD160(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('RIPEMD160', message) : syncHash('RIPEMD160', message)
}

/**
 * 异步HmacRIPEMD160哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacRIPEMD160(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacRIPEMD160哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacRIPEMD160(message: string, key: string): string
export function HmacRIPEMD160(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('RIPEMD160', message, key) : syncHmacHash('RIPEMD160', message, key)
}

/**
 * 读取流内容的RIPEMD160哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamRIPEMD160(readable: ReadableStream): Promise<string> {
    return readableStreamHash('RIPEMD160', readable)
}

/**
 * 读取流内容HmacRIPEMD160哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacRIPEMD160(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('RIPEMD160', readable, key)
}

/**
 * 异步SM3哈希算法
 * @param message
 * @param async
 * @constructor
 */
export async function SM3(message: string, async: true): Promise<string>
/**
 * 同步SM3哈希算法
 * @param message
 * @constructor
 */
export function SM3(message: string): string
export function SM3(message: string, async?: true): string | Promise<string> {
    return async ? asyncHash('SM3', message) : syncHash('SM3', message)
}

/**
 * 异步HmacSM3哈希消息认证码算法
 * @param message
 * @param key
 * @param async
 * @constructor
 */
export async function HmacSM3(message: string, key: string, async: true): Promise<string>
/**
 * 同步HmacSM3哈希消息认证码算法
 * @param message
 * @param key
 * @constructor
 */
export function HmacSM3(message: string, key: string): string
export function HmacSM3(message: string, key: string, async?: true): string | Promise<string> {
    return async ? asyncHmacHash('SM3', message, key) : syncHmacHash('SM3', message, key)
}

/**
 * 读取流内容的SM3哈希值算法
 * @param readable
 * @constructor
 */
export async function StreamSM3(readable: ReadableStream): Promise<string> {
    return readableStreamHash('SM3', readable)
}

/**
 * 读取流内容HmacSM3哈希消息认证码算法
 * @param readable
 * @param key
 * @constructor
 */
export async function StreamHmacSM3(readable: ReadableStream, key: string): Promise<string> {
    return readableStreamHmacHash('SM3', readable, key)
}
