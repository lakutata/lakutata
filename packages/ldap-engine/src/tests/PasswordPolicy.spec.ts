import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    type Control,
    createLDAPServer,
    DN,
    findControl,
    formatGeneralizedTime,
    type LDAPInProcessConnection,
    LDAPInsufficientAccessException,
    LDAPInvalidCredentialsException,
    LDAPResultException,
    LDAPUnwillingToPerformException,
    type LDAPServerEngine,
    MemoryBackend,
    type OperationContext,
    parseGeneralizedTime,
    type PasswordPolicyOptions,
    PasswordPolicyPlugin,
    PasswordPolicyRequestControl,
    PasswordPolicyResponseControl,
    type PasswordPolicyValue
} from '../exports/LDAPEngine.js'
import {
    bundledSchema,
    DEFAULTS,
    PPOLICY
} from '../exports/Schemas.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'
const POLICY: string = `cn=default,ou=policies,${BASE}`
const ASK: Control[] = [PasswordPolicyRequestControl.encode()]

/**
 * The password policy response of controls
 * @param controls The controls.
 */
function policyOf(controls: Control[] | undefined): PasswordPolicyValue | undefined {
    const control: Control | undefined = findControl(controls, PasswordPolicyResponseControl)
    return control ? PasswordPolicyResponseControl.decode(control) : undefined
}

/**
 * Whether an error is a result with a code and a password policy error
 * @param code The result code.
 * @param error The policy error.
 */
function refused(code: number, error?: PasswordPolicyValue['error']): (thrown: unknown) => boolean {
    return (thrown: unknown): boolean => thrown instanceof LDAPResultException && thrown.code === code && policyOf(thrown.controls)?.error === error
}

/**
 * A server with a default policy entry of rules, a few users, and their passwords
 * @param rules The attributes of the policy entry, by name.
 * @param options More options of the policy.
 */
async function serve(rules: Record<string, string>, options: Partial<PasswordPolicyOptions> = {}): Promise<{server: LDAPServerEngine, backend: MemoryBackend, admin: LDAPInProcessConnection}> {
    const backend: MemoryBackend = new MemoryBackend(BASE)
    const server: LDAPServerEngine = createLDAPServer({
        backends: [backend],
        access: {admins: [ADMIN]},
        passwords: {iterations: 1000},
        bindThrottle: {maxFailures: 0, ipMaxFailures: 0, delay: 0},
        passwordPolicy: {default: POLICY, ...options}
    })
    const admin: LDAPInProcessConnection = server.connect({as: ADMIN})
    await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await admin.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
    await admin.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', ...rules})
    await admin.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
    for (const name of ['alice', 'bob']) await admin.add(`uid=${name},ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: name, cn: name, sn: name, userPassword: `${name}-password-1`})
    return {server, backend, admin}
}

/**
 * Write the state of an entry as if time had passed
 * @param server The server.
 * @param backend The backend.
 * @param dn The DN.
 * @param values The operational attributes, by name.
 */
async function age(server: LDAPServerEngine, backend: MemoryBackend, dn: string, values: Record<string, string>): Promise<void> {
    const context = {schema: server.schema} as unknown as OperationContext
    await backend.modify(context as never, DN.parse(dn), Object.entries(values).map(([type, value]) => ({operation: 'replace', attribute: {type: type, values: [Buffer.from(value)]}})))
}

const ALICE: string = `uid=alice,ou=people,${BASE}`
const BOB: string = `uid=bob,ou=people,${BASE}`

describe('the password policy', () => {
    it('is a plugin, publishing its control', async () => {
        const {admin} = await serve({pwdLockout: 'TRUE'})
        const root = (await admin.search('', {scope: 'base', attributes: ['supportedControl']})).entries[0]
        assert.ok(root.get('supportedControl').includes('1.3.6.1.4.1.42.2.27.8.5.1'))
        assert.throws(() => createLDAPServer({backends: [new MemoryBackend('dc=x')], passwordPolicy: {}, plugins: [new PasswordPolicyPlugin()]}), /Two plugins are named password-policy/)
        //The plugin brings the schema ppolicy: loaded once when the server names it too; a Schema given ready must have it
        for (const schema of [DEFAULTS, [...DEFAULTS, PPOLICY]]) {
            const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend('dc=x')], schema: schema, plugins: [new PasswordPolicyPlugin()]})
            await server.start()
            assert.ok(server.schema.objectClass('pwdPolicy'))
            await server.close()
        }
        await assert.rejects(createLDAPServer({backends: [new MemoryBackend('dc=x')], schema: bundledSchema(), plugins: [new PasswordPolicyPlugin()]}).start(), /ppolicy/)
    })

    it('locks an account after too many failures, for a while, without telling it unless asked to', async () => {
        const {server, admin} = await serve({pwdLockout: 'TRUE', pwdMaxFailure: '3', pwdLockoutDuration: '1'})
        const session: LDAPInProcessConnection = server.connect()
        for (let index: number = 0; index < 3; index++) await assert.rejects(session.bind(ALICE, 'wrong', {controls: ASK}), refused(49))
        await assert.rejects(session.bind(ALICE, 'alice-password-1', {controls: ASK}), refused(49))
        const locked = (await admin.search(ALICE, {scope: 'base', attributes: ['pwdAccountLockedTime', 'pwdFailureTime']})).entries[0]
        assert.ok(locked.first('pwdAccountLockedTime'))
        assert.equal(locked.get('pwdFailureTime').length, 3)
        await new Promise((resolve) => setTimeout(resolve, 1100))
        await session.bind(ALICE, 'alice-password-1')
        const unlocked = (await admin.search(ALICE, {scope: 'base', attributes: ['+']})).entries[0]
        assert.deepEqual([unlocked.has('pwdAccountLockedTime'), unlocked.has('pwdFailureTime'), unlocked.has('pwdLastSuccess')], [false, false, true])
        const revealing = await serve({pwdLockout: 'TRUE', pwdMaxFailure: '1', pwdLockoutDuration: '0'}, {revealLocked: true})
        const other: LDAPInProcessConnection = revealing.server.connect()
        await assert.rejects(other.bind(ALICE, 'wrong', {controls: ASK}), refused(49, 'accountLocked'))
        await assert.rejects(other.bind(ALICE, 'alice-password-1', {controls: ASK}), refused(49, 'accountLocked'))
        //A password an administrator sets unlocks the account
        await revealing.admin.passwordModify({userIdentity: ALICE, newPassword: 'alice-password-2'})
        await other.bind(ALICE, 'alice-password-2')
    })

    it('locks an account again once its lockout is over, a failure still counting those kept', async () => {
        for (const revealLocked of [false, true]) {
            const {server, backend, admin} = await serve({pwdLockout: 'TRUE', pwdMaxFailure: '3', pwdLockoutDuration: '60'}, {revealLocked: revealLocked})
            //Locked an hour ago, for a minute: the lock is over, the three failures that made it still counted
            const hourAgo: number = Date.now() - 3600000
            await age(server, backend, ALICE, {pwdAccountLockedTime: formatGeneralizedTime(hourAgo)})
            await backend.modify({schema: server.schema} as never, DN.parse(ALICE), [{operation: 'replace', attribute: {type: 'pwdFailureTime', values: [1, 2, 3].map((index: number): Buffer => Buffer.from(formatGeneralizedTime(hourAgo - index * 1000)))}}])
            const session: LDAPInProcessConnection = server.connect()
            await assert.rejects(session.bind(ALICE, 'wrong', {controls: ASK}), refused(49, revealLocked ? 'accountLocked' : undefined))
            const locked: number = parseGeneralizedTime((await admin.search(ALICE, {scope: 'base', attributes: ['pwdAccountLockedTime']})).entries[0].first('pwdAccountLockedTime')!)!
            assert.ok(locked > hourAgo + 60000, formatGeneralizedTime(locked))
            await assert.rejects(session.bind(ALICE, 'alice-password-1', {controls: ASK}), refused(49, revealLocked ? 'accountLocked' : undefined))
        }
    })

    it('counts each of the failures of binds made at once, the account locked as after one at a time', async () => {
        const {server, admin} = await serve({pwdLockout: 'TRUE', pwdMaxFailure: '5', pwdLockoutDuration: '0'})
        await Promise.allSettled(Array.from({length: 10}, () => server.connect().bind(ALICE, 'wrong')))
        const entry = (await admin.search(ALICE, {scope: 'base', attributes: ['pwdAccountLockedTime', 'pwdFailureTime']})).entries[0]
        assert.ok(entry.first('pwdAccountLockedTime'))
        //The failures kept, as many as count
        assert.equal(entry.get('pwdFailureTime').length, 5)
        assert.equal(new Set(entry.get('pwdFailureTime')).size, 5)
        await assert.rejects(server.connect().bind(ALICE, 'alice-password-1'), refused(49))
        //The throttle of the failed binds, in memory: the failures made at once counted too
        const throttled: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0, lockout: 60000}})
        const writer: LDAPInProcessConnection = throttled.connect({as: ADMIN})
        await writer.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
        await writer.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
        await writer.add(BOB, {objectClass: 'inetOrgPerson', uid: 'bob', cn: 'bob', sn: 'bob', userPassword: 'bob-password-1'})
        await Promise.allSettled(Array.from({length: 10}, () => throttled.connect().bind(BOB, 'wrong')))
        await assert.rejects(throttled.connect().bind(BOB, 'bob-password-1'), LDAPInvalidCredentialsException)
    })

    it('keeps the newest failures by their times, whatever their form, and gives no failure a time ahead of the clock', async () => {
        const {server, backend, admin} = await serve({pwdMaxFailure: '2'})
        //Two failures of the same second, the first written without milliseconds: the first is the oldest
        const second: number = Math.floor((Date.now() - 10000) / 1000) * 1000
        const [oldest, newer] = [formatGeneralizedTime(second), formatGeneralizedTime(second + 250)]
        await backend.modify({schema: server.schema} as never, DN.parse(ALICE), [{operation: 'replace', attribute: {type: 'pwdFailureTime', values: [Buffer.from(oldest), Buffer.from(newer)]}}])
        await assert.rejects(server.connect().bind(ALICE, 'wrong'), refused(49))
        const kept: string[] = (await admin.search(ALICE, {scope: 'base', attributes: ['pwdFailureTime']})).entries[0].get('pwdFailureTime')
        assert.equal(kept.length, 2)
        assert.ok(kept.includes(newer) && !kept.includes(oldest), JSON.stringify(kept))
        //A failure while the clock was an hour ahead, then one once it is put back: the second is given the time of the clock
        const now: () => number = Date.now
        Date.now = (): number => now() + 3600000
        try {
            await assert.rejects(server.connect().bind(BOB, 'wrong'), refused(49))
        } finally {
            Date.now = now
        }
        await assert.rejects(server.connect().bind(BOB, 'wrong'), refused(49))
        const times: number[] = (await admin.search(BOB, {scope: 'base', attributes: ['pwdFailureTime']})).entries[0].get('pwdFailureTime').map((value: string): number => parseGeneralizedTime(value)!).sort((left: number, right: number): number => left - right)
        assert.equal(times.length, 2)
        assert.ok(times[0] <= Date.now(), JSON.stringify(times.map((time: number): string => formatGeneralizedTime(time))))
    })

    it('gives a failure a millisecond of its own when another instance recorded one in the same millisecond', async () => {
        const {server, backend, admin} = await serve({pwdMaxFailure: '5'})
        //Another instance sharing the backend recorded a failure in the millisecond this one fails in
        const now: () => number = Date.now
        const time: number = now() + 10000
        await backend.modify({schema: server.schema} as never, DN.parse(ALICE), [{operation: 'replace', attribute: {type: 'pwdFailureTime', values: [Buffer.from(formatGeneralizedTime(time))]}}])
        Date.now = (): number => time
        try {
            await assert.rejects(server.connect().bind(ALICE, 'wrong'), refused(49))
        } finally {
            Date.now = now
        }
        assert.deepEqual((await admin.search(ALICE, {scope: 'base', attributes: ['pwdFailureTime']})).entries[0].get('pwdFailureTime').sort(), [formatGeneralizedTime(time), formatGeneralizedTime(time + 1)])
    })

    it('warns before a password expires, allows the grace binds, then refuses an expired password', async () => {
        const {server, backend} = await serve({pwdMaxAge: '86400', pwdExpireWarning: '3600', pwdGraceAuthNLimit: '2'})
        const session: LDAPInProcessConnection = server.connect()
        await age(server, backend, ALICE, {pwdChangedTime: formatGeneralizedTime(Date.now() - 86000 * 1000)})
        const warned = await session.bind(ALICE, 'alice-password-1', {controls: ASK})
        const before: number | undefined = policyOf(warned.controls)?.timeBeforeExpiration
        assert.ok(before !== undefined && before > 300 && before <= 400)
        await age(server, backend, ALICE, {pwdChangedTime: formatGeneralizedTime(Date.now() - 90000 * 1000)})
        assert.equal(policyOf((await session.bind(ALICE, 'alice-password-1', {controls: ASK})).controls)?.graceAuthNsRemaining, 1)
        assert.equal(policyOf((await session.bind(ALICE, 'alice-password-1', {controls: ASK})).controls)?.graceAuthNsRemaining, 0)
        await assert.rejects(session.bind(ALICE, 'alice-password-1', {controls: ASK}), refused(49, 'passwordExpired'))
        //Without the request control, no response control
        await assert.rejects(session.bind(ALICE, 'alice-password-1'), (error: unknown) => error instanceof LDAPInvalidCredentialsException && !policyOf(error.controls))
    })

    it('makes a user change a password an administrator set before anything else', async () => {
        const {server, admin} = await serve({pwdMustChange: 'TRUE'})
        await admin.passwordModify({userIdentity: ALICE, newPassword: 'set-by-admin'})
        assert.equal((await admin.search(ALICE, {scope: 'base', attributes: ['pwdReset']})).entries[0].first('pwdReset'), 'TRUE')
        const session: LDAPInProcessConnection = server.connect()
        const bound = await session.bind(ALICE, 'set-by-admin', {controls: ASK})
        assert.equal(policyOf(bound.controls)?.error, 'changeAfterReset')
        await assert.rejects(session.search(BASE, {controls: ASK}), refused(50, 'changeAfterReset'))
        await assert.rejects(session.modify(ALICE, {operation: 'replace', attribute: 'mail', values: 'a@example.com'}), LDAPInsufficientAccessException)
        assert.equal(await session.whoAmI(), `dn:${ALICE}`)
        await session.passwordModify({oldPassword: 'set-by-admin', newPassword: 'chosen-by-alice'})
        assert.ok((await session.search(BASE, {filter: '(uid=bob)'})).entries.length)
        assert.equal((await admin.search(ALICE, {scope: 'base', attributes: ['pwdReset']})).entries[0].has('pwdReset'), false)
    })

    it('lets a session that must change its password go on once the change is written, and a bind start afresh', async () => {
        const {server, backend, admin} = await serve({pwdMustChange: 'TRUE'})
        await admin.passwordModify({userIdentity: ALICE, newPassword: 'set-by-admin'})
        //Bob has changed the password the administrator gave him
        await age(server, backend, BOB, {pwdReset: 'FALSE'})
        const session: LDAPInProcessConnection = server.connect()
        await session.bind(ALICE, 'set-by-admin')
        //A change that fails (a value to delete it does not have): the password not changed, the session still held
        await assert.rejects(session.modify(ALICE, [{operation: 'replace', attribute: 'userPassword', values: 'chosen-by-alice'}, {operation: 'delete', attribute: 'userPassword', values: 'not-a-password'}]), (error: unknown) => error instanceof LDAPResultException && error.code === 16)
        await assert.rejects(session.search(BASE, {controls: ASK}), refused(50, 'changeAfterReset'))
        //Another bind on the session: the identity before it no longer holds it
        await session.bind(BOB, 'bob-password-1')
        assert.ok((await session.search(BASE, {filter: '(uid=bob)'})).entries.length)
        //Bound again as the user, still to change its password; a change written lets it go on
        await session.bind(ALICE, 'set-by-admin')
        await assert.rejects(session.search(BASE, {controls: ASK}), refused(50, 'changeAfterReset'))
        await session.passwordModify({oldPassword: 'set-by-admin', newPassword: 'chosen-by-alice'})
        assert.ok((await session.search(BASE, {filter: '(uid=bob)'})).entries.length)
    })

    it('lets a session go on once its own change of password is done, not when another request ends meanwhile', async () => {
        //A change of Alice's password checked by the policy, then held, then refused
        let holding: boolean = false
        let reached: () => void = (): void => undefined
        const reachedPromise: Promise<void> = new Promise<void>((resolve: () => void): void => {
            reached = resolve
        })
        let release: () => void = (): void => undefined
        const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
            release = resolve
        })
        const server: LDAPServerEngine = createLDAPServer({
            backends: [new MemoryBackend(BASE)],
            access: {admins: [ADMIN]},
            passwords: {iterations: 1000},
            bindThrottle: {maxFailures: 0, ipMaxFailures: 0, delay: 0},
            passwordPolicy: {default: {mustChange: true}},
            interceptors: [{name: 'holding', operations: ['modify'], before: async (_context: unknown, request: unknown): Promise<void> => {
                if (!holding || String((request as {dn?: unknown}).dn) !== ALICE) return
                holding = false
                reached()
                await released
                throw new LDAPUnwillingToPerformException('Refused once checked')
            }}]
        })
        const admin: LDAPInProcessConnection = server.connect({as: ADMIN})
        await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
        await admin.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
        await admin.add(ALICE, {objectClass: 'inetOrgPerson', uid: 'alice', cn: 'alice', sn: 'alice', userPassword: 'set-by-admin'})
        const session: LDAPInProcessConnection = server.connect()
        await session.bind(ALICE, 'set-by-admin')
        holding = true
        const changing: Promise<unknown> = session.modify(ALICE, {operation: 'replace', attribute: 'userPassword', values: 'chosen-by-alice'})
        await reachedPromise
        //Another request of the session, done while the change is held
        assert.equal(await session.whoAmI(), `dn:${ALICE}`)
        release()
        await assert.rejects(changing, (error: unknown) => error instanceof LDAPResultException && error.code === 53)
        await assert.rejects(session.search(BASE, {controls: ASK}), refused(50, 'changeAfterReset'))
    })

    it('checks the length and the quality of the new passwords', async () => {
        const {server, admin} = await serve({pwdCheckQuality: '2', pwdMinLength: '8', pwdMaxLength: '20'}, {quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password has a digit'})
        const session: LDAPInProcessConnection = server.connect()
        await session.bind(ALICE, 'alice-password-1')
        await assert.rejects(session.passwordModify({newPassword: 'short1', controls: ASK}), refused(19, 'passwordTooShort'))
        await assert.rejects(session.passwordModify({newPassword: 'x'.repeat(21) + '1', controls: ASK}), refused(19, 'passwordTooLong'))
        await assert.rejects(session.passwordModify({newPassword: 'no-digits-here', controls: ASK}), (error: unknown) => refused(19, 'insufficientPasswordQuality')(error) && /a digit/.test((error as Error).message))
        await session.passwordModify({newPassword: 'good-password-9'})
        await assert.rejects(admin.add(`uid=carol,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'carol', cn: 'c', sn: 'c', userPassword: 'abc'}), refused(19))
        await assert.rejects(admin.add(`uid=carol,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'carol', cn: 'c', sn: 'c', userPassword: '{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7'}), refused(19))
    })

    it('checks a user\'s password looking like a hash as a password in clear, a hash an administrator imports as a hash', async () => {
        const {server, admin} = await serve({pwdCheckQuality: '1', pwdMinLength: '10'})
        const session: LDAPInProcessConnection = server.connect()
        await session.bind(ALICE, 'alice-password-1')
        //Seven characters, however it looks
        await assert.rejects(session.passwordModify({newPassword: '{SSHA}x', controls: ASK}), refused(19, 'passwordTooShort'))
        await assert.rejects(session.modify(ALICE, {operation: 'replace', attribute: 'userPassword', values: '{SSHA}x'}), (error: unknown) => error instanceof LDAPResultException && error.code === 19)
        //An administrator importing a hash: kept, its quality not checked (pwdCheckQuality 1)
        await admin.modify(BOB, {operation: 'replace', attribute: 'userPassword', values: '{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7'})
    })

    it('takes its request control on binds, writes and extended operations, as OpenLDAP does, and refuses it critical on searches', async () => {
        const {server, admin} = await serve({})
        const critical = [{...PasswordPolicyRequestControl.encode(undefined), critical: true}]
        await server.connect().bind(ALICE, 'alice-password-1', {controls: critical})
        await admin.modify(BOB, {operation: 'replace', attribute: 'description', values: 'with the control'}, {controls: critical})
        await admin.passwordModify({userIdentity: BOB, newPassword: 'bob-password-2', controls: critical})
        //A search, of the entries of a backend or of the root DSE: the same answer
        await assert.rejects(admin.search(ALICE, {scope: 'base', paged: false, controls: critical}), (error: unknown) => error instanceof LDAPResultException && error.code === 12)
        await assert.rejects(admin.search('', {scope: 'base', paged: false, controls: critical}), (error: unknown) => error instanceof LDAPResultException && error.code === 12)
        //Not critical: ignored there
        assert.equal((await admin.search(ALICE, {scope: 'base', paged: false, controls: [PasswordPolicyRequestControl.encode(undefined)]})).entries.length, 1)
    })

    it('keeps one password for an entry under a policy, as the policy assumes', async () => {
        const {server, admin} = await serve({pwdInHistory: '3'})
        const session: LDAPInProcessConnection = server.connect()
        await session.bind(ALICE, 'alice-password-1')
        //A second password added: refused (the first would stay valid, the second out of the history)
        await assert.rejects(session.modify(ALICE, {operation: 'add', attribute: 'userPassword', values: 'another-password'}), (error: unknown) => error instanceof LDAPResultException && error.code === 19)
        await assert.rejects(admin.add(`uid=carol,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'carol', cn: 'carol', sn: 'carol', userPassword: ['first-password', 'second-password']}), (error: unknown) => error instanceof LDAPResultException && error.code === 19)
        assert.equal((await admin.search(ALICE, {scope: 'base', attributes: ['userPassword']})).entries.length, 1)
        await server.connect().bind(ALICE, 'alice-password-1')
        //A change: the old one deleted and the new one added, or replaced
        await session.modify(ALICE, [{operation: 'delete', attribute: 'userPassword', values: 'alice-password-1'}, {operation: 'add', attribute: 'userPassword', values: 'alice-password-2'}])
        await session.modify(ALICE, {operation: 'replace', attribute: 'userPassword', values: 'alice-password-3'})
        //An entry given two passwords before (by an older directory): changed the safe way, the old one given, as it may
        //go on with as many as it has, never more
        const {server: carried, backend, admin: carrier} = await serve({pwdSafeModify: 'TRUE'})
        const stored = backend.entries().find((entry) => entry.dn.toString() === ALICE)!
        backend.load([{dn: stored.dn, attributes: stored.attributes.map((attribute) => attribute.type === 'userPassword' ? {type: attribute.type, values: [...attribute.values, Buffer.from('{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7')]} : attribute)}])
        const owner: LDAPInProcessConnection = carried.connect()
        await owner.bind(ALICE, 'alice-password-1')
        await owner.modify(ALICE, [{operation: 'delete', attribute: 'userPassword', values: 'alice-password-1'}, {operation: 'add', attribute: 'userPassword', values: 'alice-password-2'}])
        await carried.connect().bind(ALICE, 'alice-password-2')
        await assert.rejects(owner.modify(ALICE, [{operation: 'delete', attribute: 'userPassword', values: 'alice-password-2'}, {operation: 'add', attribute: 'userPassword', values: ['alice-password-3', 'alice-password-4']}]), (error: unknown) => error instanceof LDAPResultException && error.code === 19)
        //Nor given several new ones at once, however many it has
        await assert.rejects(carrier.modify(ALICE, {operation: 'replace', attribute: 'userPassword', values: ['alice-password-5', 'alice-password-6']}), (error: unknown) => error instanceof LDAPResultException && error.code === 19)
        //Without a policy, several passwords as the schema allows
        const {admin: free} = await serve({}, {default: undefined})
        await free.add(`uid=dave,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'dave', cn: 'dave', sn: 'dave', userPassword: ['first-password', 'second-password']})
    })

    it('refuses the passwords of the history, and the current one', async () => {
        const {server, admin} = await serve({pwdInHistory: '2'})
        const session: LDAPInProcessConnection = server.connect()
        await session.bind(ALICE, 'alice-password-1')
        await assert.rejects(session.passwordModify({newPassword: 'alice-password-1', controls: ASK}), refused(19, 'passwordInHistory'))
        await session.passwordModify({newPassword: 'alice-password-2'})
        await session.passwordModify({newPassword: 'alice-password-3'})
        await assert.rejects(session.passwordModify({newPassword: 'alice-password-2', controls: ASK}), refused(19, 'passwordInHistory'))
        await session.passwordModify({newPassword: 'alice-password-4'})
        //Only two former passwords are kept: the first may come back
        await session.passwordModify({newPassword: 'alice-password-1'})
        assert.equal((await admin.search(ALICE, {scope: 'base', attributes: ['pwdHistory']})).entries[0].getBuffers('pwdHistory').length, 2)
    })

    it('makes users wait before changing again, give their old password, or not change it at all', async () => {
        const young = await serve({pwdMinAge: '3600'})
        const session: LDAPInProcessConnection = young.server.connect()
        await session.bind(ALICE, 'alice-password-1')
        //Set when the entry was added: too young to change yet
        await assert.rejects(session.passwordModify({newPassword: 'alice-password-2', controls: ASK}), refused(19, 'passwordTooYoung'))
        await age(young.server, young.backend, ALICE, {pwdChangedTime: formatGeneralizedTime(Date.now() - 7200 * 1000)})
        await session.passwordModify({newPassword: 'alice-password-2'})
        await assert.rejects(session.passwordModify({newPassword: 'alice-password-3', controls: ASK}), refused(19, 'passwordTooYoung'))
        await young.admin.passwordModify({userIdentity: ALICE, newPassword: 'alice-password-3'})
        const safe = await serve({pwdSafeModify: 'TRUE'})
        const careful: LDAPInProcessConnection = safe.server.connect()
        await careful.bind(BOB, 'bob-password-1')
        await assert.rejects(careful.passwordModify({newPassword: 'bob-password-2', controls: ASK}), refused(50, 'mustSupplyOldPassword'))
        await assert.rejects(careful.modify(BOB, {operation: 'replace', attribute: 'userPassword', values: 'bob-password-2'}), refused(50))
        await careful.passwordModify({oldPassword: 'bob-password-1', newPassword: 'bob-password-2'})
        await careful.modify(BOB, [{operation: 'delete', attribute: 'userPassword', values: 'bob-password-2'}, {operation: 'add', attribute: 'userPassword', values: 'bob-password-3'}])
        await safe.server.connect().bind(BOB, 'bob-password-3')
        const fixed = await serve({pwdAllowUserChange: 'FALSE'})
        const user: LDAPInProcessConnection = fixed.server.connect()
        await user.bind(BOB, 'bob-password-1')
        await assert.rejects(user.passwordModify({newPassword: 'bob-password-2', controls: ASK}), refused(50, 'passwordModNotAllowed'))
    })

    it('takes the policy of a user\'s pwdPolicySubentry, and locks an account left unused', async () => {
        const {server, backend, admin} = await serve({pwdMinLength: '1'})
        await admin.add(`cn=strict,ou=policies,${BASE}`, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'strict', pwdAttribute: 'userPassword', pwdCheckQuality: '2', pwdMinLength: '12', pwdMaxIdle: '60'})
        await admin.modify(BOB, {operation: 'add', attribute: 'pwdPolicySubentry', values: `cn=strict,ou=policies,${BASE}`})
        const bob: LDAPInProcessConnection = server.connect()
        await bob.bind(BOB, 'bob-password-1')
        await assert.rejects(bob.passwordModify({newPassword: 'too-short', controls: ASK}), refused(19, 'passwordTooShort'))
        const alice: LDAPInProcessConnection = server.connect()
        await alice.bind(ALICE, 'alice-password-1')
        await alice.passwordModify({newPassword: 'short'})
        await age(server, backend, BOB, {pwdLastSuccess: formatGeneralizedTime(Date.now() - 120 * 1000)})
        await assert.rejects(server.connect().bind(BOB, 'bob-password-1'), LDAPInvalidCredentialsException)
    })
})
