import 'reflect-metadata'
import CryptoJs from 'crypto-js'
import {NotSupportHashException} from '../exceptions/NotSupportHashException'
import {Readable as ReadableStream} from 'stream'
import {Sm3, SM3ToHex, SM3Hmac} from '../lib/deps/SM3'
import {createHash, createHmac, getHashes, Hash as CryptoHash, Hmac as CryptoHmac} from 'crypto'
import {Helper} from './Helper'

/**
 * 系统所支持的哈希算法
 */
const SUPPORT_HASHES: string[] = getHashes().map((value: string) => value.toUpperCase())

/**
 * 数据缓冲区阈值
 */
const HIGH_WATER_MARK: number = 16384

interface HashFallback {
    update(data: string): HashFallback

    digest(): Buffer
}

/**
 * 判断是否为内置的哈希算法
 * @param algorithm
 */
function isBuiltinHashAlgorithm(algorithm: string): boolean {
    //通过IGNORE_BUILT_IN_HASHES环境变量判断是否需要忽略自带的哈希算法
    if (process.env.IGNORE_BUILT_IN_HASHES) return false
    return SUPPORT_HASHES.includes(algorithm)
}

/**
 * 哈希兼容性处理
 * @param algorithm
 */
function createHashFallback(algorithm: string): HashFallback {
    const parts: string[] = algorithm.split('-')
    const mainAlgorithm: string = parts[0]
    switch (mainAlgorithm) {
        case 'MD5': {
            let md5Hasher = CryptoJs.algo.MD5.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    md5Hasher = md5Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(md5Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA1': {
            let sha1Hasher = CryptoJs.algo.SHA1.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha1Hasher = sha1Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha1Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA256': {
            let sha256Hasher = CryptoJs.algo.SHA256.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha256Hasher = sha256Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha256Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA224': {
            let sha224Hasher = CryptoJs.algo.SHA224.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha224Hasher = sha224Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha224Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA512': {
            let sha512Hasher = CryptoJs.algo.SHA512.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha512Hasher = sha512Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha512Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA384': {
            let sha384Hasher = CryptoJs.algo.SHA384.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha384Hasher = sha384Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha384Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'RIPEMD160': {
            let ripemd160Hasher = CryptoJs.algo.RIPEMD160.create()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    ripemd160Hasher = ripemd160Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(ripemd160Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA3': {
            let sha3Hasher = CryptoJs.algo.SHA3.create({outputLength: parseInt(parts[1])})
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha3Hasher = sha3Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha3Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SM3': {
            const sm3Hasher = new Sm3()
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sm3Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(SM3ToHex(sm3Hasher.finalize()), 'hex')
                }
            }
            return hash
        }
        default:
            throw new NotSupportHashException('Algorithm "{0}" is not supported', [algorithm])
    }
}

/**
 * 哈希消息认证码兼容性处理
 * @param algorithm
 * @param key
 */
function createHmacFallback(algorithm: string, key: string): HashFallback {
    const parts: string[] = algorithm.split('-')
    const mainAlgorithm: string = parts[0]
    switch (mainAlgorithm) {
        case 'MD5': {
            let md5Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.MD5, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    md5Hasher = md5Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(md5Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA1': {
            let sha1Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.SHA1, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha1Hasher = sha1Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha1Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA256': {
            let sha256Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.SHA256, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha256Hasher = sha256Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha256Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA224': {
            let sha224Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.SHA224, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha224Hasher = sha224Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha224Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA512': {
            let sha512Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.SHA512, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha512Hasher = sha512Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha512Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA384': {
            let sha384Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.SHA384, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha384Hasher = sha384Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha384Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'RIPEMD160': {
            let ripemd160Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.RIPEMD160, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    ripemd160Hasher = ripemd160Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(ripemd160Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SHA3': {
            let sha3Hasher = CryptoJs.algo.HMAC.create(CryptoJs.algo.SHA3, key)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sha3Hasher = sha3Hasher.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(sha3Hasher.finalize().toString(), 'hex')
                }
            }
            return hash
        }
        case 'SM3': {
            const sm3Hasher = new Sm3()
            const sm3Hmac = new SM3Hmac(key, sm3Hasher)
            const hash: HashFallback = {
                update(data: string): HashFallback {
                    sm3Hmac.update(data)
                    return hash
                },
                digest(): Buffer {
                    return Buffer.from(SM3ToHex(sm3Hmac.finalize()), 'hex')
                }
            }
            return hash
        }
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
        try {
            const hash: CryptoHash | HashFallback = isBuiltinHashAlgorithm(algorithm) ? createHash(algorithm) : createHashFallback(algorithm)
            Helper.ConvertToStream(message, {highWaterMark: HIGH_WATER_MARK})
                .on('data', chunk => hash.update(chunk))
                .once('error', reject)
                .once('end', () => resolve(hash.digest().toString('hex')))
        } catch (e) {
            return reject(new NotSupportHashException(<Error>e))
        }
    })
}

/**
 * 同步哈希计算
 * @param algorithm
 * @param message
 */
function syncHash(algorithm: string, message: string): string {
    try {
        const hash: CryptoHash | HashFallback = isBuiltinHashAlgorithm(algorithm) ? createHash(algorithm) : createHashFallback(algorithm)
        return hash.update(message).digest().toString('hex')
    } catch (e) {
        throw new NotSupportHashException(<Error>e)
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
        try {
            const hmac: CryptoHmac | HashFallback = isBuiltinHashAlgorithm(algorithm) ? createHmac(algorithm, key) : createHmacFallback(algorithm, key)
            Helper.ConvertToStream(message, {highWaterMark: HIGH_WATER_MARK})
                .on('data', chunk => hmac.update(chunk))
                .once('error', reject)
                .once('end', () => resolve(hmac.digest().toString('hex')))
        } catch (e) {
            return reject(new NotSupportHashException(<Error>e))
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
    try {
        const hmac: CryptoHmac | HashFallback = isBuiltinHashAlgorithm(algorithm) ? createHmac(algorithm, key) : createHmacFallback(algorithm, key)
        return hmac.update(message).digest().toString('hex')
    } catch (e) {
        throw new NotSupportHashException(<Error>e)
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
            const hash: CryptoHash | HashFallback = isBuiltinHashAlgorithm(algorithm) ? createHash(algorithm) : createHashFallback(algorithm)
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
            const hmac: CryptoHmac | HashFallback = isBuiltinHashAlgorithm(algorithm) ? createHmac(algorithm, key) : createHmacFallback(algorithm, key)
            readable.on('data', chunk => hmac.update(chunk))
                .once('error', reject)
                .once('end', () => resolve(hmac.digest().toString('hex')))
        } catch (e) {
            return reject(new NotSupportHashException(<Error>e))
        }
    })
}

/********************************************************分割线********************************************************/

export class Hash {
    /**
     * 异步MD5哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async MD5(message: string, async: true): Promise<string>
    /**
     * 同步MD5哈希算法
     * @param message
     * @constructor
     */
    public static MD5(message: string): string
    public static MD5(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('MD5', message) : syncHash('MD5', message)
    }

    /**
     * 异步HmacMD5哈希消息认证码算法
     * @constructor
     */
    public static async HmacMD5(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacMD5哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacMD5(message: string, key: string): string
    public static HmacMD5(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('MD5', message, key) : syncHmacHash('MD5', message, key)
    }

    /**
     * 读取流内容的MD5哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamMD5(readable: ReadableStream): Promise<string> {
        return readableStreamHash('MD5', readable)
    }

    /**
     * 读取流内容HmacMD5哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacMD5(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('MD5', readable, key)
    }

    /**
     * 异步SHA1哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA1(message: string, async: true): Promise<string>
    /**
     * 同步SHA1哈希算法
     * @param message
     * @constructor
     */
    public static SHA1(message: string): string
    public static SHA1(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA1', message) : syncHash('SHA1', message)
    }

    /**
     * 异步HmacSHA1哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA1(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA1哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA1(message: string, key: string): string
    public static HmacSHA1(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA1', message, key) : syncHmacHash('SHA1', message, key)
    }

    /**
     * 读取流内容的SHA1哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA1(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA1', readable)
    }

    /**
     * 读取流内容HmacSHA1哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA1(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA1', readable, key)
    }

    /**
     * 异步SHA256哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA256(message: string, async: true): Promise<string>
    /**
     * 同步SHA256哈希算法
     * @param message
     * @constructor
     */
    public static SHA256(message: string): string
    public static SHA256(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA256', message) : syncHash('SHA256', message)
    }

    /**
     * 异步HmacSHA256哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA256(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA256哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA256(message: string, key: string): string
    public static HmacSHA256(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA256', message, key) : syncHmacHash('SHA256', message, key)
    }

    /**
     * 读取流内容的SHA256哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA256(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA256', readable)
    }

    /**
     * 读取流内容HmacSHA256哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA256(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA256', readable, key)
    }

    /**
     * 异步SHA224哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA224(message: string, async: true): Promise<string>
    /**
     * 同步SHA224哈希算法
     * @param message
     * @constructor
     */
    public static SHA224(message: string): string
    public static SHA224(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA224', message) : syncHash('SHA224', message)
    }

    /**
     * 异步HmacSHA224哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA224(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA224哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA224(message: string, key: string): string
    public static HmacSHA224(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA224', message, key) : syncHmacHash('SHA224', message, key)
    }

    /**
     * 读取流内容的SHA224哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA224(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA224', readable)
    }

    /**
     * 读取流内容HmacSHA224哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA224(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA224', readable, key)
    }

    /**
     * 异步SHA512哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA512(message: string, async: true): Promise<string>
    /**
     * 同步SHA512哈希算法
     * @param message
     * @constructor
     */
    public static SHA512(message: string): string
    public static SHA512(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA512', message) : syncHash('SHA512', message)
    }

    /**
     * 异步HmacSHA512哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA512(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA512哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA512(message: string, key: string): string
    public static HmacSHA512(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA512', message, key) : syncHmacHash('SHA512', message, key)
    }

    /**
     * 读取流内容的SHA512哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA512(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA512', readable)
    }

    /**
     * 读取流内容HmacSHA512哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA512(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA512', readable, key)
    }

    /**
     * 异步SHA384哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA384(message: string, async: true): Promise<string>
    /**
     * 同步SHA384哈希算法
     * @param message
     * @constructor
     */
    public static SHA384(message: string): string
    public static SHA384(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA384', message) : syncHash('SHA384', message)
    }

    /**
     * 异步HmacSHA384哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA384(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA384哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA384(message: string, key: string): string
    public static HmacSHA384(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA384', message, key) : syncHmacHash('SHA384', message, key)
    }

    /**
     * 读取流内容的SHA384哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA384(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA384', readable)
    }

    /**
     * 读取流内容HmacSHA384哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA384(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA384', readable, key)
    }

    /**
     * 异步SHA3哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA3(message: string, async: true): Promise<string>
    /**
     * 同步SHA3哈希算法
     * @param message
     * @constructor
     */
    public static SHA3(message: string): string
    public static SHA3(message: string, async?: true): string | Promise<string> {
        return async ? this.SHA3_512(message, true) : this.SHA3_512(message)
    }

    /**
     * 异步HmacSHA3哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA3(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA3哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA3(message: string, key: string): string
    public static HmacSHA3(message: string, key: string, async?: true): string | Promise<string> {
        return async ? this.HmacSHA3_512(message, key, true) : this.HmacSHA3_512(message, key)
    }

    /**
     * 读取流内容的SHA3哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA3(readable: ReadableStream): Promise<string> {
        return this.StreamSHA3_512(readable)
    }

    /**
     * 读取流内容HmacSHA3哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA3(readable: ReadableStream, key: string): Promise<string> {
        return this.StreamHmacSHA3_512(readable, key)
    }

    /**
     * 异步SHA3_224哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA3_224(message: string, async: true): Promise<string>
    /**
     * 同步SHA3哈希算法
     * @param message
     * @constructor
     */
    public static SHA3_224(message: string): string
    public static SHA3_224(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA3-224', message) : syncHash('SHA3-224', message)
    }

    /**
     * 异步HmacSHA3_224哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA3_224(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA3_224哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA3_224(message: string, key: string): string
    public static HmacSHA3_224(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA3-224', message, key) : syncHmacHash('SHA3-224', message, key)
    }

    /**
     * 读取流内容的SHA3_224哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA3_224(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA3-224', readable)
    }

    /**
     * 读取流内容HmacSHA3_224哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA3_224(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA3_-24', readable, key)
    }

    /**
     * 异步SHA3_256哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA3_256(message: string, async: true): Promise<string>
    /**
     * 同步SHA3_256哈希算法
     * @param message
     * @constructor
     */
    public static SHA3_256(message: string): string
    public static SHA3_256(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA3-256', message) : syncHash('SHA3-256', message)
    }

    /**
     * 异步HmacSHA3_256哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA3_256(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA3_256哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA3_256(message: string, key: string): string
    public static HmacSHA3_256(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA3-256', message, key) : syncHmacHash('SHA3-256', message, key)
    }

    /**
     * 读取流内容的SHA3_256哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA3_256(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA3-256', readable)
    }

    /**
     * 读取流内容HmacSHA3_256哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA3_256(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA3-256', readable, key)
    }

    /**
     * 异步SHA3_384哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA3_384(message: string, async: true): Promise<string>
    /**
     * 同步SHA3_384哈希算法
     * @param message
     * @constructor
     */
    public static SHA3_384(message: string): string
    public static SHA3_384(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA3-384', message) : syncHash('SHA3-384', message)
    }

    /**
     * 异步HmacSHA3_384哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA3_384(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA3_384哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA3_384(message: string, key: string): string
    public static HmacSHA3_384(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA3-384', message, key) : syncHmacHash('SHA3-384', message, key)
    }

    /**
     * 读取流内容的SHA3_384哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA3_384(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA3-384', readable)
    }

    /**
     * 读取流内容HmacSHA3_384哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA3_384(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA3-384', readable, key)
    }

    /**
     * 异步SHA3_512哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SHA3_512(message: string, async: true): Promise<string>
    /**
     * 同步SHA3_512哈希算法
     * @param message
     * @constructor
     */
    public static SHA3_512(message: string): string
    public static SHA3_512(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SHA3-512', message) : syncHash('SHA3-512', message)
    }

    /**
     * 异步HmacSHA3_512哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSHA3_512(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSHA3_512哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSHA3_512(message: string, key: string): string
    public static HmacSHA3_512(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SHA3-512', message, key) : syncHmacHash('SHA3-512', message, key)
    }

    /**
     * 读取流内容的SHA3_512哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSHA3_512(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SHA3-512', readable)
    }

    /**
     * 读取流内容HmacSHA3_512哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSHA3_512(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SHA3-512', readable, key)
    }

    /**
     * 异步RIPEMD160哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async RIPEMD160(message: string, async: true): Promise<string>
    /**
     * 同步RIPEMD160哈希算法
     * @param message
     * @constructor
     */
    public static RIPEMD160(message: string): string
    public static RIPEMD160(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('RIPEMD160', message) : syncHash('RIPEMD160', message)
    }

    /**
     * 异步HmacRIPEMD160哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacRIPEMD160(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacRIPEMD160哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacRIPEMD160(message: string, key: string): string
    public static HmacRIPEMD160(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('RIPEMD160', message, key) : syncHmacHash('RIPEMD160', message, key)
    }

    /**
     * 读取流内容的RIPEMD160哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamRIPEMD160(readable: ReadableStream): Promise<string> {
        return readableStreamHash('RIPEMD160', readable)
    }

    /**
     * 读取流内容HmacRIPEMD160哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacRIPEMD160(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('RIPEMD160', readable, key)
    }

    /**
     * 异步SM3哈希算法
     * @param message
     * @param async
     * @constructor
     */
    public static async SM3(message: string, async: true): Promise<string>
    /**
     * 同步SM3哈希算法
     * @param message
     * @constructor
     */
    public static SM3(message: string): string
    public static SM3(message: string, async?: true): string | Promise<string> {
        return async ? asyncHash('SM3', message) : syncHash('SM3', message)
    }

    /**
     * 异步HmacSM3哈希消息认证码算法
     * @param message
     * @param key
     * @param async
     * @constructor
     */
    public static async HmacSM3(message: string, key: string, async: true): Promise<string>
    /**
     * 同步HmacSM3哈希消息认证码算法
     * @param message
     * @param key
     * @constructor
     */
    public static HmacSM3(message: string, key: string): string
    public static HmacSM3(message: string, key: string, async?: true): string | Promise<string> {
        return async ? asyncHmacHash('SM3', message, key) : syncHmacHash('SM3', message, key)
    }

    /**
     * 读取流内容的SM3哈希值算法
     * @param readable
     * @constructor
     */
    public static async StreamSM3(readable: ReadableStream): Promise<string> {
        return readableStreamHash('SM3', readable)
    }

    /**
     * 读取流内容HmacSM3哈希消息认证码算法
     * @param readable
     * @param key
     * @constructor
     */
    public static async StreamHmacSM3(readable: ReadableStream, key: string): Promise<string> {
        return readableStreamHmacHash('SM3', readable, key)
    }
}
