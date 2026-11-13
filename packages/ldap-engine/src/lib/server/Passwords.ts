import * as crypto from 'node:crypto'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import {compare as bcryptCompare} from './bcrypt/index.js'
import {md5Crypt, shaCrypt} from './Crypt.js'

/**
 * The options of hashing a password
 */
export interface PasswordHashOptions {
    /**
     * The iterations of PBKDF2 (220000 by default)
     */
    iterations?: number
}

/**
 * A password storage scheme, the `{SCHEME}` before a value of `userPassword` (RFC 3112 and the schemes of OpenLDAP)
 */
export interface PasswordScheme {
    /**
     * Its name, without the braces (`SSHA`, `PBKDF2-SHA512`)
     */
    readonly name: string
    /**
     * Whether a password is the one a value of the scheme holds
     * @param value The value after `{SCHEME}`.
     * @param password The password.
     */
    verify(value: string, password: Buffer): Promise<boolean> | boolean
    /**
     * The value of the scheme for a password, after `{SCHEME}`; a scheme without it only verifies
     * @param password The password.
     * @param options The options.
     */
    hash?(password: Buffer, options: PasswordHashOptions): Promise<string> | string
    /**
     * Whether a value of the scheme is weaker than the options ask (fewer iterations), so a bind hashes it again
     * @param value The value after `{SCHEME}`.
     * @param options The options.
     */
    weakerThan?(value: string, options: PasswordHashOptions): boolean
}

const DEFAULT_ITERATIONS: number = 220000

/**
 * Whether two byte strings are equal, in a time that does not depend on where they differ
 * @param left One.
 * @param right The other.
 */
function equalBytes(left: Buffer, right: Buffer): boolean {
    if (left.length !== right.length) {
        crypto.timingSafeEqual(left, left)
        return false
    }
    return crypto.timingSafeEqual(left, right)
}

/**
 * The adapted base64 of the PBKDF2 hashes of OpenLDAP and passlib: `.` instead of `+`, no padding
 * @param bytes The bytes.
 */
function ab64(bytes: Buffer): string {
    return bytes.toString('base64').replace(/=+$/, '').replace(/\+/g, '.')
}

/**
 * The bytes of adapted base64
 * @param text The text.
 */
function fromAb64(text: string): Buffer {
    return Buffer.from(text.replace(/\./g, '+'), 'base64')
}

/**
 * A digest scheme with an optional salt after the digest (`{SHA}`, `{SSHA}`, `{SSHA512}`, `{MD5}`, `{SMD5}`)
 * @param name The name.
 * @param algorithm The digest.
 * @param salted Whether a salt follows the digest.
 */
function digestScheme(name: string, algorithm: string, salted: boolean): PasswordScheme {
    const size: number = crypto.createHash(algorithm).digest().length
    return {
        name: name,
        verify: (value: string, password: Buffer): boolean => {
            const bytes: Buffer = Buffer.from(value, 'base64')
            if (bytes.length < size || (!salted && bytes.length !== size)) return false
            const salt: Buffer = bytes.subarray(size)
            return equalBytes(crypto.createHash(algorithm).update(password).update(salt).digest(), bytes.subarray(0, size))
        },
        hash: (password: Buffer): string => {
            const salt: Buffer = salted ? crypto.randomBytes(8) : Buffer.alloc(0)
            return Buffer.concat([crypto.createHash(algorithm).update(password).update(salt).digest(), salt]).toString('base64')
        }
    }
}

/**
 * A PBKDF2 scheme in the format of the pw-pbkdf2 module of OpenLDAP: `<iterations>$<salt>$<hash>` in adapted base64
 * @param name The name.
 * @param digest The digest of the HMAC.
 * @param size The length of the hash.
 */
function pbkdf2Scheme(name: string, digest: string, size: number): PasswordScheme {
    const derive = (password: Buffer, salt: Buffer, iterations: number): Promise<Buffer> => new Promise((resolve: (key: Buffer) => void, reject: (error: Error) => void): void => {
        crypto.pbkdf2(password, salt, iterations, size, digest, (error: Error | null, key: Buffer): void => error ? reject(error) : resolve(key))
    })
    return {
        name: name,
        verify: async (value: string, password: Buffer): Promise<boolean> => {
            const match: RegExpExecArray | null = /^(\d+)\$([^$]+)\$([^$]+)$/.exec(value)
            if (!match) return false
            const iterations: number = Number(match[1])
            const expected: Buffer = fromAb64(match[3])
            if (iterations < 1 || iterations > 10000000 || expected.length !== size) return false
            return equalBytes(await derive(password, fromAb64(match[2]), iterations), expected)
        },
        hash: async (password: Buffer, options: PasswordHashOptions): Promise<string> => {
            const iterations: number = options.iterations ?? DEFAULT_ITERATIONS
            const salt: Buffer = crypto.randomBytes(16)
            return `${iterations}$${ab64(salt)}$${ab64(await derive(password, salt, iterations))}`
        },
        weakerThan: (value: string, options: PasswordHashOptions): boolean => Number(/^(\d+)\$/.exec(value)?.[1] ?? 0) < (options.iterations ?? DEFAULT_ITERATIONS)
    }
}

/**
 * The `{CRYPT}` scheme: the crypts of FreeBSD (`$1$`), Ulrich Drepper (`$5$`, `$6$`) and bcrypt (`$2a$`, `$2b$`, `$2y$`)
 */
const CRYPT: PasswordScheme = {
    name: 'CRYPT',
    verify: async (value: string, password: Buffer): Promise<boolean> => {
        let computed: string | undefined
        if (value.startsWith('$1$')) computed = md5Crypt(password, value)
        else if (value.startsWith('$5$') || value.startsWith('$6$')) computed = shaCrypt(password, value)
        else if (/^\$2[aby]\$\d\d\$/.test(value)) return bcryptCompare(password.toString('utf8'), value).catch((): boolean => false)
        return computed !== undefined && equalBytes(Buffer.from(computed), Buffer.from(value))
    }
}

type Argon2 = (algorithm: string, parameters: {message: Buffer, nonce: Buffer, parallelism: number, tagLength: number, memory: number, passes: number}, callback: (error: Error | null, key: Buffer) => void) => void

//The argon2 of node:crypto once tried: null when it is missing or refuses to run
let supportedArgon2: Argon2 | null | undefined

/**
 * The argon2 of node:crypto, from Node.js 24.7 on, where it runs: Electron has the function, but its BoringSSL refuses
 * the algorithm (ERR_CRYPTO_ARGON2_NOT_SUPPORTED)
 */
export function argon2Function(): Argon2 | undefined {
    if (supportedArgon2 === undefined) {
        const {argon2, argon2Sync} = crypto as unknown as {argon2?: unknown, argon2Sync?: (algorithm: string, parameters: Record<string, unknown>) => Buffer}
        supportedArgon2 = null
        if (typeof argon2 === 'function' && typeof argon2Sync === 'function') {
            try {
                //node-compat: crypto.argon2Sync (tried only where node:crypto has it); the smallest parameters
                argon2Sync('argon2id', {message: Buffer.alloc(1), nonce: Buffer.alloc(8), parallelism: 1, tagLength: 4, memory: 8, passes: 1})
                supportedArgon2 = argon2 as Argon2
            } catch {
                supportedArgon2 = null
            }
        }
    }
    return supportedArgon2 ?? undefined
}

/**
 * The `{ARGON2}` scheme of the pw-argon2 module of OpenLDAP (`$argon2id$v=19$m=65536,t=2,p=1$<salt>$<hash>`), where
 * node:crypto runs argon2 (Node.js 24.7 and later, not Electron)
 */
const ARGON2: PasswordScheme = {
    name: 'ARGON2',
    verify: async (value: string, password: Buffer): Promise<boolean> => {
        const argon2: Argon2 | undefined = argon2Function()
        const match: RegExpExecArray | null = /^\$(argon2id|argon2i|argon2d)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(value)
        if (!argon2 || !match) return false
        const expected: Buffer = Buffer.from(match[6], 'base64')
        const [memory, passes, parallelism] = [Number(match[2]), Number(match[3]), Number(match[4])]
        if (memory > 4194304 || passes > 1000 || parallelism > 255 || expected.length < 4) return false
        const key: Buffer = await new Promise((resolve: (key: Buffer) => void, reject: (error: Error) => void): void => {
            //node-compat: crypto.argon2 (used only when node:crypto has it, checked above)
            argon2(match[1], {message: password, nonce: Buffer.from(match[5], 'base64'), parallelism: parallelism, tagLength: expected.length, memory: memory, passes: passes}, (error: Error | null, result: Buffer): void => error ? reject(error) : resolve(result))
        })
        return equalBytes(key, expected)
    }
}

/**
 * The password storage schemes of a server: the scheme the passwords are written in (`{PBKDF2-SHA512}` by default,
 * as the pw-pbkdf2 module of OpenLDAP writes it), and the schemes the binds verify: `{PBKDF2}`, `{PBKDF2-SHA1}`,
 * `{PBKDF2-SHA256}`, `{PBKDF2-SHA512}`, `{SSHA}`, `{SSHA256}`, `{SSHA384}`, `{SSHA512}`, `{SHA}`, `{SHA256}`,
 * `{SHA384}`, `{SHA512}`, `{SMD5}`, `{MD5}`, `{CRYPT}` (`$1$`, `$5$`, `$6$`, bcrypt) and `{ARGON2}` (where node:crypto
 * runs argon2). A value without a scheme is a password in clear, which a bind compares as it is.
 * @example
 * ```typescript
 * import {PasswordSchemes} from '@lakutata/ldap-engine'
 *
 * async function check(): Promise<void> {
 *     const schemes: PasswordSchemes = new PasswordSchemes({iterations: 300000})
 *     const stored: string = await schemes.hash('secret')
 *     console.log(stored.startsWith('{PBKDF2-SHA512}300000$'), await schemes.verify(stored, 'secret'))
 *     console.log(await schemes.verify('{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7', 'secret'))
 * }
 * ```
 */
export class PasswordSchemes {
    /**
     * The schemes, by their names in upper case
     */
    protected readonly registered: Map<string, PasswordScheme> = new Map()

    /**
     * The scheme the passwords are written in
     */
    public readonly scheme: string

    /**
     * The options of hashing
     */
    public readonly options: PasswordHashOptions

    /**
     * The schemes of a server
     * @param options The scheme the passwords are written in, the iterations of PBKDF2.
     */
    constructor(options: PasswordHashOptions & {scheme?: string} = {}) {
        for (const scheme of [
            pbkdf2Scheme('PBKDF2', 'sha1', 20),
            pbkdf2Scheme('PBKDF2-SHA1', 'sha1', 20),
            pbkdf2Scheme('PBKDF2-SHA256', 'sha256', 32),
            pbkdf2Scheme('PBKDF2-SHA512', 'sha512', 64),
            digestScheme('SSHA', 'sha1', true),
            digestScheme('SSHA256', 'sha256', true),
            digestScheme('SSHA384', 'sha384', true),
            digestScheme('SSHA512', 'sha512', true),
            digestScheme('SHA', 'sha1', false),
            digestScheme('SHA256', 'sha256', false),
            digestScheme('SHA384', 'sha384', false),
            digestScheme('SHA512', 'sha512', false),
            digestScheme('SMD5', 'md5', true),
            digestScheme('MD5', 'md5', false),
            CRYPT,
            ARGON2
        ]) this.register(scheme)
        this.scheme = (options.scheme ?? 'PBKDF2-SHA512').toUpperCase()
        this.options = {iterations: options.iterations ?? DEFAULT_ITERATIONS}
        if (!this.registered.get(this.scheme)?.hash) throw new LDAPUsageException(`The password scheme ${this.scheme} cannot hash`)
    }

    /**
     * Add a scheme, or replace the one of its name
     * @param scheme The scheme.
     * @throws {LDAPUsageException} When its name is not one a stored value `{NAME}…` can carry (letters, digits, `.`
     * and `-`).
     */
    public register(scheme: PasswordScheme): this {
        if (typeof scheme.name !== 'string' || !/^[A-Za-z0-9.-]+$/.test(scheme.name)) throw new LDAPUsageException(`The name of a password scheme is made of letters, digits, '.' and '-': ${String(scheme.name)}`)
        this.registered.set(scheme.name.toUpperCase(), scheme)
        return this
    }

    /**
     * The names of the schemes
     */
    public names(): string[] {
        return [...this.registered.values()].map((scheme: PasswordScheme): string => scheme.name)
    }

    /**
     * The scheme of a stored value, undefined for a password in clear (or a scheme not registered)
     * @param stored The value.
     */
    public schemeOf(stored: Buffer | string): PasswordScheme | undefined {
        const match: RegExpExecArray | null = /^\{([A-Za-z0-9.-]+)\}/.exec(typeof stored === 'string' ? stored : stored.toString('latin1'))
        return match ? this.registered.get(match[1].toUpperCase()) : undefined
    }

    /**
     * Whether a value is a hashed password (it starts with a registered `{SCHEME}`)
     * @param stored The value.
     */
    public isHashed(stored: Buffer | string): boolean {
        return this.schemeOf(stored) !== undefined
    }

    /**
     * Hash a password in the scheme of the server, or another
     * @param password The password.
     * @param scheme The scheme; the one of the server by default.
     * @returns The value, `{SCHEME}` first.
     */
    public async hash(password: Buffer | string, scheme: string = this.scheme): Promise<string> {
        const found: PasswordScheme | undefined = this.registered.get(scheme.toUpperCase())
        if (!found?.hash) throw new LDAPUsageException(`The password scheme ${scheme} cannot hash`)
        return `{${found.name}}${await found.hash(typeof password === 'string' ? Buffer.from(password, 'utf8') : password, this.options)}`
    }

    /**
     * Whether a password is the one a stored value holds: by its scheme, or compared as it is for a value in clear
     * @param stored The value.
     * @param password The password.
     */
    public async verify(stored: Buffer | string, password: Buffer | string): Promise<boolean> {
        const value: Buffer = typeof stored === 'string' ? Buffer.from(stored, 'utf8') : stored
        const bytes: Buffer = typeof password === 'string' ? Buffer.from(password, 'utf8') : password
        const scheme: PasswordScheme | undefined = this.schemeOf(value)
        if (!scheme) return equalBytes(value, bytes)
        try {
            return await scheme.verify(value.toString('utf8').slice(scheme.name.length + 2), bytes)
        } catch {
            return false
        }
    }

    /**
     * Whether a stored value should be hashed again after a bind: in clear, in another scheme, or weaker
     * @param stored The value.
     */
    public needsRehash(stored: Buffer | string): boolean {
        const scheme: PasswordScheme | undefined = this.schemeOf(stored)
        if (!scheme || scheme.name.toUpperCase() !== this.scheme) return true
        const text: string = typeof stored === 'string' ? stored : stored.toString('utf8')
        return scheme.weakerThan?.(text.slice(scheme.name.length + 2), this.options) ?? false
    }
}
