import {findControl, PasswordPolicyRequestControl, type PasswordPolicyError, PasswordPolicyResponseControl, type PasswordPolicyValue} from '../controls/Controls.js'
import {resultException} from '../../exceptions/LDAPResultException.js'
import {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {formatGeneralizedTime, parseGeneralizedTime} from '../schema/MatchingRules.js'
import type {Schema} from '../schema/Schema.js'
import {valuesOfType} from './EntryTools.js'
import type {PasswordSchemes} from './Passwords.js'
import type {DirectoryChange, DirectoryEntry, OperationContext} from './Types.js'

/**
 * The rules of a password policy, as the attributes of a pwdPolicy entry give them (draft-behera-ldap-password-policy):
 * the durations in seconds, 0 or absent meaning no limit
 */
export interface PasswordPolicyRules {
    /**
     * The age at which a password expires (pwdMaxAge)
     */
    maxAge?: number
    /**
     * The age before which a user cannot change their password again (pwdMinAge)
     */
    minAge?: number
    /**
     * How many former passwords cannot be used again (pwdInHistory)
     */
    inHistory?: number
    /**
     * Whether the quality is checked: 0 not, 1 when it can be (a hashed password passes), 2 always (pwdCheckQuality)
     */
    checkQuality?: 0 | 1 | 2
    /**
     * The fewest characters of a password (pwdMinLength)
     */
    minLength?: number
    /**
     * The most characters of a password (pwdMaxLength)
     */
    maxLength?: number
    /**
     * How long before the expiration a bind is warned (pwdExpireWarning)
     */
    expireWarning?: number
    /**
     * The binds allowed with an expired password (pwdGraceAuthNLimit)
     */
    graceAuthNLimit?: number
    /**
     * How long after the expiration the grace binds are allowed (pwdGraceExpiry)
     */
    graceExpiry?: number
    /**
     * Whether too many failures lock the account (pwdLockout)
     */
    lockout?: boolean
    /**
     * How long a locked account stays locked; 0 until an administrator resets its password (pwdLockoutDuration)
     */
    lockoutDuration?: number
    /**
     * The failures that lock the account (pwdMaxFailure)
     */
    maxFailure?: number
    /**
     * How long failures count (pwdFailureCountInterval); 0 until a successful bind
     */
    failureCountInterval?: number
    /**
     * Whether a user must change a password an administrator set before doing anything else (pwdMustChange)
     */
    mustChange?: boolean
    /**
     * Whether users change their own passwords (pwdAllowUserChange; true by default)
     */
    allowUserChange?: boolean
    /**
     * Whether a user changing their password gives the old one (pwdSafeModify)
     */
    safeModify?: boolean
    /**
     * The delay of the answer to a first failure, doubled at each failure (pwdMinDelay)
     */
    minDelay?: number
    /**
     * The longest delay of an answer to a failure (pwdMaxDelay)
     */
    maxDelay?: number
    /**
     * How long an account may stay unused before it is locked (pwdMaxIdle)
     */
    maxIdle?: number
    /**
     * How many failures are kept (pwdMaxRecordedFailure; maxFailure by default)
     */
    maxRecordedFailure?: number
}

/**
 * The password policy of a server: the default policy (the DN of a pwdPolicy entry, or its rules), which a user's
 * pwdPolicySubentry replaces, a quality check of one's own, and whether a locked account is told as such
 */
export interface PasswordPolicyOptions {
    /**
     * The policy of the users without a pwdPolicySubentry: the DN of a pwdPolicy entry, or its rules; none by default
     */
    default?: string | PasswordPolicyRules
    /**
     * A quality check of one's own, run on the new passwords when the policy checks the quality: false, or a message,
     * refuses the password (with insufficientPasswordQuality)
     * @param password The new password.
     * @param request The DN of the entry and the entry, undefined for an entry being added.
     */
    quality?(password: Buffer, request: {dn: DN, entry?: DirectoryEntry}): boolean | string | Promise<boolean | string>
    /**
     * Whether a bind of a locked account gets the accountLocked error in the response control (false by default: a
     * locked account is not told apart from a wrong password)
     */
    revealLocked?: boolean
}

/**
 * The key of the session state telling that the session must change its password first
 */
export const MUST_CHANGE: unique symbol = Symbol('the password must be changed first')

//The value of pwdAccountLockedTime locking an account for good
const LOCKED_FOR_GOOD: string = '000001010000Z'
//The syntax the history stores the passwords in (Octet String)
const HISTORY_SYNTAX: string = '1.3.6.1.4.1.1466.115.121.1.40'

/**
 * The rules of a pwdPolicy entry
 * @param entry The entry.
 * @param schema The schema.
 * @example
 * ```typescript
 * import {bundledSchema, DN, rulesOfEntry, type PasswordPolicyRules} from '@lakutata/ldap-engine'
 *
 * const rules: PasswordPolicyRules = rulesOfEntry({
 *     dn: DN.parse('cn=default,ou=policies,dc=example,dc=com'),
 *     attributes: [{type: 'pwdMaxAge', values: [Buffer.from('7776000')]}, {type: 'pwdLockout', values: [Buffer.from('TRUE')]}]
 * }, bundledSchema())
 * console.log(rules.maxAge, rules.lockout) //7776000 true
 * ```
 */
export function rulesOfEntry(entry: DirectoryEntry, schema: Schema): PasswordPolicyRules {
    const text = (type: string): string | undefined => valuesOfType(entry, type, schema)[0]?.toString('utf8')
    const number = (type: string): number | undefined => {
        const value: string | undefined = text(type)
        return value === undefined || !/^-?\d+$/.test(value) ? undefined : Number(value)
    }
    const flag = (type: string): boolean | undefined => {
        const value: string | undefined = text(type)
        return value === undefined ? undefined : value.toUpperCase() === 'TRUE'
    }
    const rules: PasswordPolicyRules = {
        maxAge: number('pwdMaxAge'),
        minAge: number('pwdMinAge'),
        inHistory: number('pwdInHistory'),
        checkQuality: number('pwdCheckQuality') as 0 | 1 | 2 | undefined,
        minLength: number('pwdMinLength'),
        maxLength: number('pwdMaxLength'),
        expireWarning: number('pwdExpireWarning'),
        graceAuthNLimit: number('pwdGraceAuthNLimit'),
        graceExpiry: number('pwdGraceExpiry'),
        lockout: flag('pwdLockout'),
        lockoutDuration: number('pwdLockoutDuration'),
        maxFailure: number('pwdMaxFailure'),
        failureCountInterval: number('pwdFailureCountInterval'),
        mustChange: flag('pwdMustChange'),
        allowUserChange: flag('pwdAllowUserChange'),
        safeModify: flag('pwdSafeModify'),
        minDelay: number('pwdMinDelay'),
        maxDelay: number('pwdMaxDelay'),
        maxIdle: number('pwdMaxIdle'),
        maxRecordedFailure: number('pwdMaxRecordedFailure')
    }
    return Object.fromEntries(Object.entries(rules).filter(([, value]: [string, unknown]): boolean => value !== undefined)) as PasswordPolicyRules
}

/**
 * A change replacing an attribute with values, or removing it (no value)
 * @param type The attribute.
 * @param values The values.
 */
function replace(type: string, ...values: string[]): DirectoryChange {
    return {operation: 'replace', attribute: {type: type, values: values.map((value: string): Buffer => Buffer.from(value, 'utf8'))}}
}

/**
 * Throw a result with a password policy error in the response control, when the client asked for it
 * @param context The context.
 * @param code The result code.
 * @param message The message.
 * @param error The error of the control.
 */
function refuse(context: OperationContext, code: number, message: string, error?: PasswordPolicyError): never {
    if (error) respond(context, {error: error})
    throw resultException({resultCode: code, matchedDN: '', diagnosticMessage: message}, context.responseControls)
}

/**
 * Add a password policy response control, when the client asked for it (draft-behera §8)
 * @param context The context.
 * @param value The value.
 */
function respond(context: OperationContext, value: PasswordPolicyValue): void {
    if (findControl(context.controls, PasswordPolicyRequestControl)) context.responseControls.push(PasswordPolicyResponseControl.encode(value))
}

/**
 * A time of an entry, in milliseconds
 * @param entry The entry.
 * @param type The attribute.
 * @param schema The schema.
 */
function timeOf(entry: DirectoryEntry, type: string, schema: Schema): number | undefined {
    const value: string | undefined = valuesOfType(entry, type, schema)[0]?.toString('utf8')
    return value === undefined ? undefined : parseGeneralizedTime(value)
}

/**
 * The password policy of the engine (draft-behera-ldap-password-policy): on the binds (locking, expiration, grace,
 * warnings, the password to change first) and on the password changes (who changes, the old password, the age, the
 * quality, the history), its state kept in the operational attributes of the entries (pwdChangedTime,
 * pwdAccountLockedTime, pwdFailureTime, pwdHistory, pwdGraceUseTime, pwdReset, pwdLastSuccess)
 */
export class PasswordPolicy {
    /**
     * The policy
     * @param options The options.
     * @param schema The schema.
     * @param passwords The password schemes.
     * @param getEntry An entry by its DN, in any backend.
     * @param writeState Write state changes to an entry, as the engine.
     */
    constructor(
        protected readonly options: PasswordPolicyOptions,
        protected readonly schema: Schema,
        protected readonly passwords: PasswordSchemes,
        protected readonly getEntry: (context: OperationContext, dn: DN) => Promise<DirectoryEntry | undefined>,
        protected readonly writeState: (context: OperationContext, dn: DN, changes: DirectoryChange[]) => Promise<void>
    ) {
    }

    /**
     * The rules governing an entry: its pwdPolicySubentry, or the default policy; undefined without one
     * @param context The context.
     * @param entry The entry.
     */
    public async rulesFor(context: OperationContext, entry: DirectoryEntry | undefined): Promise<PasswordPolicyRules | undefined> {
        const subentry: string | undefined = entry ? valuesOfType(entry, 'pwdPolicySubentry', this.schema)[0]?.toString('utf8') : undefined
        const source: string | PasswordPolicyRules | undefined = subentry ?? this.options.default
        if (source === undefined) return undefined
        if (typeof source !== 'string') return source
        const policy: DirectoryEntry | undefined = await this.getEntry(context, DN.parse(source))
        return policy ? rulesOfEntry(policy, this.schema) : undefined
    }

    /**
     * Whether an account is locked (§7.1)
     * @param rules The rules.
     * @param entry The entry.
     * @param now The time.
     */
    public isLocked(rules: PasswordPolicyRules, entry: DirectoryEntry, now: number): boolean {
        const lockedText: string | undefined = valuesOfType(entry, 'pwdAccountLockedTime', this.schema)[0]?.toString('utf8')
        if (lockedText === LOCKED_FOR_GOOD) return true
        const start: number | undefined = timeOf(entry, 'pwdStartTime', this.schema)
        if (start !== undefined && now < start) return true
        const end: number | undefined = timeOf(entry, 'pwdEndTime', this.schema)
        if (end !== undefined && now >= end) return true
        if (rules.maxIdle) {
            const last: number | undefined = timeOf(entry, 'pwdLastSuccess', this.schema) ?? timeOf(entry, 'pwdChangedTime', this.schema)
            if (last !== undefined && now >= last + rules.maxIdle * 1000) return true
        }
        const locked: number | undefined = lockedText === undefined ? undefined : parseGeneralizedTime(lockedText)
        if (locked !== undefined) return !rules.lockoutDuration || now < locked + rules.lockoutDuration * 1000
        return false
    }

    /**
     * The failure times that still count (§7.6)
     * @param rules The rules.
     * @param entry The entry.
     * @param now The time.
     */
    protected failures(rules: PasswordPolicyRules, entry: DirectoryEntry, now: number): string[] {
        return valuesOfType(entry, 'pwdFailureTime', this.schema)
            .map((value: Buffer): string => value.toString('utf8'))
            .filter((value: string): boolean => {
                const time: number | undefined = parseGeneralizedTime(value)
                return time !== undefined && (!rules.failureCountInterval || now - time < rules.failureCountInterval * 1000)
            })
            .sort()
    }

    /**
     * A bind with a password, its verification run by `verify` (which throws invalidCredentials on a wrong password):
     * the locked accounts refused, the failures counted and the account locked after too many, the expiration, the
     * grace binds and the warnings applied, the password to change first noted on the session (§8.1)
     * @param context The context of the bind.
     * @param dn The DN of the bind.
     * @param verify The verification.
     */
    public async authenticate(context: OperationContext, dn: DN, verify: () => Promise<void>): Promise<void> {
        const entry: DirectoryEntry | undefined = await this.getEntry(context, dn)
        const rules: PasswordPolicyRules | undefined = entry ? await this.rulesFor(context, entry) : undefined
        if (!entry || !rules) return verify()
        const now: number = Date.now()
        if (this.isLocked(rules, entry, now)) {
            await verify().catch((): undefined => undefined)
            refuse(context, ResultCode.invalidCredentials, 'Invalid credentials', this.options.revealLocked ? 'accountLocked' : undefined)
        }
        try {
            await verify()
        } catch (error) {
            if ((error as {code?: number}).code !== ResultCode.invalidCredentials) throw error
            const failures: string[] = [...this.failures(rules, entry, now), formatGeneralizedTime(now)]
            const kept: string[] = failures.slice(-Math.max(rules.maxRecordedFailure || rules.maxFailure || failures.length, 1))
            const changes: DirectoryChange[] = [replace('pwdFailureTime', ...kept)]
            const lockNow: boolean = rules.lockout === true && !!rules.maxFailure && kept.length >= rules.maxFailure
            if (lockNow) changes.push(replace('pwdAccountLockedTime', formatGeneralizedTime(now)))
            await this.writeState(context, dn, changes)
            if (rules.minDelay) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, Math.min(rules.minDelay! * 2 ** (kept.length - 1), rules.maxDelay ?? rules.minDelay!) * 1000))
            refuse(context, ResultCode.invalidCredentials, 'Invalid credentials', lockNow && this.options.revealLocked ? 'accountLocked' : undefined)
        }
        //The password is right
        const changes: DirectoryChange[] = [replace('pwdFailureTime'), replace('pwdAccountLockedTime'), replace('pwdLastSuccess', formatGeneralizedTime(now))]
        const reset: boolean = valuesOfType(entry, 'pwdReset', this.schema)[0]?.toString('utf8').toUpperCase() === 'TRUE'
        const changed: number | undefined = timeOf(entry, 'pwdChangedTime', this.schema)
        let warning: PasswordPolicyValue | undefined
        if (rules.mustChange && reset) {
            context.session.state.set(MUST_CHANGE, true)
            warning = {error: 'changeAfterReset'}
        } else if (rules.maxAge && changed !== undefined && now - changed > rules.maxAge * 1000) {
            //Expired: a grace bind, or none left (§8.1.2.3)
            const used: number = valuesOfType(entry, 'pwdGraceUseTime', this.schema).length
            const expiredAt: number = changed + rules.maxAge * 1000
            const remaining: number = rules.graceExpiry && now > expiredAt + rules.graceExpiry * 1000 ? 0 : Math.max((rules.graceAuthNLimit ?? 0) - used, 0)
            if (!remaining) {
                await this.writeState(context, dn, changes.slice(0, 2))
                refuse(context, ResultCode.invalidCredentials, 'Invalid credentials', 'passwordExpired')
            }
            changes.push({operation: 'add', attribute: {type: 'pwdGraceUseTime', values: [Buffer.from(formatGeneralizedTime(now))]}})
            warning = {graceAuthNsRemaining: remaining - 1}
        } else if (rules.maxAge && rules.expireWarning && changed !== undefined) {
            const age: number = (now - changed) / 1000
            if (age >= rules.maxAge - rules.expireWarning) warning = {timeBeforeExpiration: Math.max(Math.floor(rules.maxAge - age), 0)}
        }
        await this.writeState(context, dn, changes)
        if (warning) respond(context, warning)
    }

    /**
     * Refuse an operation of a session that must change its password first (§8.3): everything but binds, its own
     * password change, Who Am I, unbinds, abandons and StartTLS
     * @param context The context.
     * @param allowed Whether the operation is one of those allowed.
     */
    public guard(context: OperationContext, allowed: boolean): void {
        if (allowed || !context.session.state.get(MUST_CHANGE)) return
        refuse(context, ResultCode.insufficientAccessRights, 'The password must be changed first', 'changeAfterReset')
    }

    /**
     * Check a password change and give the changes of the policy state it makes (§8.2): who changes (pwdAllowUserChange),
     * the old password (pwdSafeModify), the age (pwdMinAge), the quality and the length, the history
     * @param context The context.
     * @param dn The DN of the entry.
     * @param entry The entry, undefined for an entry being added.
     * @param passwords The new passwords as they were written (in clear, or hashed by an administrator importing them).
     * @param change Whether the user changes their own password, and whether they gave the old one.
     * @returns The state changes, undefined when no policy governs the entry.
     */
    public async check(context: OperationContext, dn: DN, entry: DirectoryEntry | undefined, passwords: Buffer[], change: {self: boolean, oldGiven: boolean, entryAttributes?: PartialAttribute[]}): Promise<DirectoryChange[] | undefined> {
        const rules: PasswordPolicyRules | undefined = await this.rulesFor(context, entry ?? (change.entryAttributes ? {dn: dn, attributes: change.entryAttributes} : undefined))
        if (!rules) return undefined
        const now: number = Date.now()
        const mustChange: boolean = context.session.state.get(MUST_CHANGE) === true && change.self
        const current: Buffer[] = entry ? valuesOfType(entry, 'userPassword', this.schema) : []
        if (change.self && rules.allowUserChange === false) refuse(context, ResultCode.insufficientAccessRights, 'Users do not change their passwords', 'passwordModNotAllowed')
        if (change.self && rules.safeModify && current.length && !change.oldGiven) refuse(context, ResultCode.insufficientAccessRights, 'The old password must be given', 'mustSupplyOldPassword')
        if (change.self && !mustChange && rules.minAge && entry) {
            const changed: number | undefined = timeOf(entry, 'pwdChangedTime', this.schema)
            if (changed !== undefined && now - changed < rules.minAge * 1000) refuse(context, ResultCode.constraintViolation, 'The password was changed too recently', 'passwordTooYoung')
        }
        for (const password of passwords) {
            const hashed: boolean = this.passwords.isHashed(password)
            if (rules.checkQuality) {
                if (hashed) {
                    if (rules.checkQuality === 2) refuse(context, ResultCode.constraintViolation, 'The quality of a hashed password cannot be checked', 'insufficientPasswordQuality')
                } else {
                    const length: number = [...password.toString('utf8')].length
                    if (rules.minLength && length < rules.minLength) refuse(context, ResultCode.constraintViolation, `A password has at least ${rules.minLength} characters`, 'passwordTooShort')
                    if (rules.maxLength && length > rules.maxLength) refuse(context, ResultCode.constraintViolation, `A password has at most ${rules.maxLength} characters`, 'passwordTooLong')
                    const quality: boolean | string = this.options.quality ? await this.options.quality(password, {dn: dn, entry: entry}) : true
                    if (quality !== true) refuse(context, ResultCode.constraintViolation, typeof quality === 'string' ? quality : 'The password is not good enough', 'insufficientPasswordQuality')
                }
            }
            if (rules.inHistory && entry && !hashed) {
                const history: Buffer[] = valuesOfType(entry, 'pwdHistory', this.schema).map((value: Buffer): Buffer => {
                    const text: string = value.toString('utf8')
                    const parts: string[] = text.split('#')
                    return parts.length >= 4 ? Buffer.from(parts.slice(3).join('#'), 'utf8') : value
                })
                for (const former of [...current, ...history]) {
                    if (await this.passwords.verify(former, password)) refuse(context, ResultCode.constraintViolation, 'The password was used before', 'passwordInHistory')
                }
            }
        }
        //The state the change leaves (§8.2.7)
        const time: string = formatGeneralizedTime(now)
        const changes: DirectoryChange[] = [replace('pwdChangedTime', time), replace('pwdFailureTime'), replace('pwdGraceUseTime'), replace('pwdLastSuccess')]
        if (rules.inHistory && entry) {
            const history: string[] = valuesOfType(entry, 'pwdHistory', this.schema).map((value: Buffer): string => value.toString('utf8'))
            const added: string[] = current.map((value: Buffer): string => `${time}#${HISTORY_SYNTAX}#${value.length}#${value.toString('utf8')}`)
            changes.push(replace('pwdHistory', ...[...history, ...added].sort().slice(-rules.inHistory)))
        }
        changes.push(rules.mustChange && !change.self ? replace('pwdReset', 'TRUE') : replace('pwdReset'))
        //A password an administrator sets unlocks the account
        if (!change.self) changes.push(replace('pwdAccountLockedTime'))
        if (change.self) context.session.state.delete(MUST_CHANGE)
        return changes
    }
}
