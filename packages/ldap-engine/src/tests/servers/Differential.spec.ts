//The server engine against OpenLDAP, request by request (test-env/openldap/differential.sh gives the URL of an
//OpenLDAP, whose sssvlv overlay the test loads): the same entries in both, the same requests sent as a client of
//another vendor sends them (the controls built by hand, no paging by the client), the answers compared. Skipped
//without the URL.
import assert from 'node:assert/strict'
import {after, before, describe, it} from 'node:test'
import {
    connectLDAP,
    type Control,
    createLDAPServer,
    type LDAPClientConnection,
    LDAPResultException,
    type LDAPServerEngine,
    MemoryBackend,
    PagedResultsControl,
    SortRequestControl,
    SortResponseControl,
    VLVRequestControl,
    VLVResponseControl
} from '../../exports/LDAPEngine.js'
import {DEFAULTS, RFC2307BIS} from '../../exports/Schemas.js'

const URL: string | undefined = process.env.LDAP_TEST_URL
const BASE: string = process.env.LDAP_TEST_BASE ?? 'dc=example,dc=com'
const ADMIN: string = process.env.LDAP_TEST_ADMIN ?? 'cn=admin,dc=example,dc=com'
const PASSWORD: string = process.env.LDAP_TEST_PASSWORD ?? 'secret'
const CONFIG_PASSWORD: string = process.env.LDAP_TEST_CONFIG_PASSWORD ?? 'config'
const UNIT: string = `ou=diff-${process.pid},${BASE}`
const TLS = {rejectUnauthorized: false}

//The entries of both: some without uidNumber (the key of the sorts, with an ordering rule in both schemas), some with
//a description tagged by language, one with two values of cn
const PEOPLE: Record<string, string | string[]>[] = [
    {uid: 'd1', cn: ['Delta One', 'Delta Uno'], sn: 'One', uidNumber: '1040', description: 'first'},
    {uid: 'd2', cn: 'Delta Two', sn: 'Two', uidNumber: '1010', 'description;lang-en': 'second'},
    {uid: 'd3', cn: 'Delta Three', sn: 'Three', description: 'third', 'description;lang-en': 'third in english'},
    {uid: 'd4', cn: 'Delta Four', sn: 'Four', uidNumber: '1030'},
    {uid: 'd5', cn: 'Delta Five', sn: 'Five', uidNumber: '1020', 'description;lang-de': 'fünfte'},
    {uid: 'd6', cn: 'Delta Six', sn: 'Six'},
    {uid: 'd7', cn: 'Delta Seven', sn: 'Seven', uidNumber: '1060'},
    {uid: 'd8', cn: 'Delta Eight', sn: 'Eight', uidNumber: '1050'}
]

/**
 * An entry of the people as added: posixAccount for those with a uidNumber
 * @param person The person.
 */
function personEntry(person: Record<string, string | string[]>): Record<string, string | string[]> {
    if (!person.uidNumber) return {objectClass: 'inetOrgPerson', ...person}
    return {objectClass: ['inetOrgPerson', 'posixAccount'], ...person, gidNumber: '100', homeDirectory: `/home/${String(person.uid)}`}
}

/**
 * What a server answers to a search, as compared: the result code, the entries (their DNs, in the order sent unless
 * sorted by the caller), their attribute descriptions and values, and the response controls decoded
 */
interface Answer {
    code: number
    dns: string[]
    attributes: string[][]
    controls: Record<string, unknown>
}

/**
 * The response controls, decoded into what is compared
 * @param controls The controls.
 */
function decoded(controls: readonly Control[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const control of controls) {
        if (control.oid === PagedResultsControl.oid) result.paged = {cookie: PagedResultsControl.decode(control).cookie.length > 0}
        else if (control.oid === SortResponseControl.oid) result.sort = SortResponseControl.decode(control).result
        else if (control.oid === VLVResponseControl.oid) {
            const value = VLVResponseControl.decode(control)
            result.vlv = {targetPosition: value.targetPosition, contentCount: value.contentCount, result: value.result}
        }
    }
    return result
}

/**
 * Send a search and collect its answer
 * @param connection The connection.
 * @param base The base.
 * @param options The options of the search, the controls as sent.
 */
async function answer(connection: LDAPClientConnection, base: string, options: {scope?: 'base' | 'one' | 'sub', filter?: string, attributes?: string[], controls?: Control[], sizeLimit?: number}): Promise<Answer> {
    try {
        const result = await connection.search(base, {scope: options.scope ?? 'one', filter: options.filter ?? '(objectClass=*)', attributes: options.attributes ?? ['1.1'], paged: false, controls: options.controls ?? [], ...options.sizeLimit ? {sizeLimit: options.sizeLimit} : {}})
        return {
            code: result.truncated ? 4 : 0,
            dns: result.entries.map((entry): string => entry.dn.toLowerCase()),
            attributes: result.entries.map((entry): string[] => entry.attributes.flatMap((attribute): string[] => attribute.values.map((value: Buffer): string => `${attribute.type.toLowerCase()}=${value.toString('utf8')}`)).sort()),
            controls: decoded(result.controls)
        }
    } catch (error) {
        if (!(error instanceof LDAPResultException)) throw error
        return {code: error.code, dns: [], attributes: [], controls: decoded(error.controls ?? [])}
    }
}

describe('the server engine against OpenLDAP', {skip: !URL}, () => {
    let engine: LDAPServerEngine
    let ours: LDAPClientConnection
    let theirs: LDAPClientConnection

    /**
     * The answers of both servers to the same search
     * @param base The base, below the unit of the test when relative.
     * @param options The options of the search.
     */
    const both = async (base: string, options: Parameters<typeof answer>[2] = {}): Promise<{ours: Answer, theirs: Answer}> => {
        const [mine, other] = await Promise.all([answer(ours, base, options), answer(theirs, base, options)])
        return {ours: mine, theirs: other}
    }

    before(async () => {
        //OpenLDAP, its sssvlv overlay loaded (sort and virtual list view)
        const config: LDAPClientConnection = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await config.bind('cn=admin,cn=config', CONFIG_PASSWORD)
        const modules = await config.search('cn=config', {scope: 'one', filter: '(objectClass=olcModuleList)', attributes: ['olcModuleLoad']})
        if (!modules.entries.some((entry) => entry.get('olcModuleLoad').some((value: string) => value.includes('sssvlv')))) await config.modify(modules.entries[0].dn, {operation: 'add', attribute: 'olcModuleLoad', values: 'sssvlv'})
        const databases = await config.search('cn=config', {scope: 'one', filter: '(olcSuffix=*)', attributes: ['olcSuffix']})
        const database: string = databases.entries.find((entry) => entry.get('olcSuffix').some((value: string) => value.toLowerCase() === BASE))!.dn
        const overlays = await config.search(database, {scope: 'one', filter: '(objectClass=olcSssVlvConfig)', attributes: ['1.1']})
        //Its virtual list views kept by connection: as many as the requests of the test
        if (!overlays.entries.length) await config.add(`olcOverlay=sssvlv,${database}`, {objectClass: ['olcOverlayConfig', 'olcSssVlvConfig'], olcOverlay: 'sssvlv', olcSssVlvMax: '1000', olcSssVlvMaxPerConn: '1000'})
        await config.close()
        theirs = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await theirs.bind(ADMIN, PASSWORD)
        //The engine, on a port of the loopback
        engine = createLDAPServer({backends: [new MemoryBackend(BASE)], schema: [...DEFAULTS, RFC2307BIS], access: {admins: [ADMIN]}, passwords: {iterations: 1000}})
        const owner = engine.connect({as: ADMIN})
        await owner.add(BASE, {objectClass: ['dcObject', 'organization'], dc: BASE.split(',')[0].split('=')[1], o: 'Example'})
        await owner.add(ADMIN, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'admin', userPassword: PASSWORD})
        const port: number = await engine.listen({port: 0, host: '127.0.0.1'})
        ours = await connectLDAP({url: `ldap://127.0.0.1:${port}`})
        await ours.bind(ADMIN, PASSWORD)
        //The same entries in both
        for (const connection of [ours, theirs]) {
            await connection.add(UNIT, {objectClass: ['top', 'organizationalUnit'], ou: `diff-${process.pid}`})
            for (const person of PEOPLE) await connection.add(`uid=${String(person.uid)},${UNIT}`, personEntry(person))
        }
    })

    after(async () => {
        for await (const entry of theirs.searchIterator(UNIT, {scope: 'one', attributes: ['1.1']})) await theirs.delete(entry.dn)
        await theirs.delete(UNIT)
        await theirs.close()
        await ours.close()
        await engine.close()
    })

    const sort = (attribute: string, reverse?: boolean, orderingRule?: string): Control => SortRequestControl.encode([{attribute, ...reverse ? {reverse} : {}, ...orderingRule ? {orderingRule} : {}}])
    const view = (value: Parameters<typeof VLVRequestControl.encode>[0], critical?: boolean): Control => VLVRequestControl.encode(value, critical)
    const raw = (oid: string, bytes: number[], critical: boolean = true): Control => ({oid, critical, value: Buffer.from(bytes)})
    const PEOPLE_FILTER: string = '(objectClass=inetOrgPerson)'

    /**
     * The answers of both servers, alike
     * @param base The base.
     * @param options The options of the search.
     */
    const alike = async (base: string, options: Parameters<typeof answer>[2]): Promise<Answer> => {
        const {ours: mine, theirs: other} = await both(base, options)
        assert.deepEqual(mine, other)
        return mine
    }

    it('evaluates a presence of an attribute neither knows as undefined', async () => {
        for (const filter of ['(!(shoeSize=*))', '(shoeSize=*)', '(|(shoeSize=*)(uid=d1))', '(!(shoeSize=x))', '(!(&(shoeSize=*)(uid=d1)))']) await alike(UNIT, {filter, attributes: ['uid'], controls: [sort('uidNumber')]})
    })

    it('returns for an attribute asked with options the attributes having them', async () => {
        for (const attributes of [['description'], ['description;lang-en'], ['description;lang-de'], ['description;x-unknown'], ['description;LANG-EN'], ['cn;lang-en']]) await alike(UNIT, {filter: '(|(uid=d1)(uid=d2)(uid=d3)(uid=d5))', attributes, controls: [sort('uid', false, '2.5.13.3')]})
        //binary is a transfer option for the engine, ignored in the comparison (userCertificate;binary gives the
        //certificates); OpenLDAP refuses it on an attribute whose syntax does not need it and returns nothing
        const binary: Answer = (await both(UNIT, {filter: '(uid=d1)', attributes: ['description;binary']})).ours
        assert.deepEqual(binary.attributes, [['description=first']])
    })

    it('sorts alike, the entries without a value last, and first in reverse', async () => {
        for (const reverse of [false, true]) await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber', reverse)]})
        await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uid', false, '2.5.13.3')]})
    })

    it('answers a sort it cannot do as RFC 2891 says', async () => {
        //OpenLDAP fails the search (16, or 18 for a rule) even when the control is not critical; RFC 2891 (scenario 4)
        //returns the entries unsorted with the result in the sort response control, and unavailableCriticalExtension
        //when it is critical (scenario 3)
        const unknown: Answer = (await both(UNIT, {filter: PEOPLE_FILTER, controls: [sort('shoeSize')]})).ours
        assert.deepEqual([unknown.code, unknown.dns.length, unknown.controls.sort], [0, PEOPLE.length, 16])
        assert.deepEqual(await both(UNIT, {filter: PEOPLE_FILTER, controls: [{...sort('shoeSize'), critical: true}]}).then(({ours: mine}) => [mine.code, mine.controls.sort]), [12, 16])
        assert.deepEqual(await both(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uid', false, '1.2.3.4.5')]}).then(({ours: mine}) => [mine.code, mine.controls.sort]), [0, 18])
        assert.deepEqual(await both(UNIT, {filter: PEOPLE_FILTER, controls: [{...sort('uid', false, '1.2.3.4.5'), critical: true}]}).then(({ours: mine}) => [mine.code, mine.controls.sort]), [12, 18])
    })

    it('views the entries alike: offsets scaled, greaterThanOrEqual forward and in reverse', async () => {
        for (const [offset, contentCount, beforeCount, afterCount] of [[2, 4, 0, 1], [4, 4, 0, 0], [1, 5, 0, 0], [3, 0, 1, 1], [8, 0, 0, 0], [8, 8, 0, 2]]) await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber'), view({beforeCount, afterCount, offset: {offset, contentCount}})]})
        for (const [value, reverse] of [['1030', false], ['1030', true], ['1035', false], ['1035', true], ['2000', false], ['900', true], ['900', false], ['2000', true]] as [string, boolean][]) await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber', reverse), view({beforeCount: 1, afterCount: 1, greaterThanOrEqual: Buffer.from(value)})]})
        await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('cn', false, '2.5.13.3'), view({beforeCount: 0, afterCount: 2, greaterThanOrEqual: Buffer.from('Delta T')})]})
        for (const target of [{offset: {offset: 1, contentCount: 0}}, {offset: {offset: 1, contentCount: 5}}, {greaterThanOrEqual: Buffer.from('1')}]) await alike(UNIT, {filter: '(uid=nobody)', controls: [sort('uidNumber'), view({beforeCount: 0, afterCount: 2, ...target})]})
        await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber'), view({beforeCount: 0, afterCount: 1, offset: {offset: 1, contentCount: 0}}), PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]})
    })

    it('takes an offset equal to the count of the client as the last entry, 1 of 1 too', async (t) => {
        //The draft (§5): Ci = Cc is the last entry, Ci = 1 the first only when Cc is not 1
        const {ours: mine, theirs: other} = await both(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber'), view({beforeCount: 0, afterCount: 0, offset: {offset: 1, contentCount: 1}})]})
        assert.deepEqual(mine.controls.vlv, {targetPosition: PEOPLE.length, contentCount: PEOPLE.length, result: 0})
        t.diagnostic(`OpenLDAP for 1 of 1: ${JSON.stringify(other.controls.vlv)}`)
    })

    it('refuses a view as the draft says', async () => {
        //Past the last entry: OpenLDAP answers 76 with its own view result 77; the draft's is offsetRangeError (61).
        //An offset below 1: OpenLDAP takes it, the draft (offset INTEGER (1 .. maxInt)) refuses it
        for (const [offset, contentCount] of [[9, 0], [5, 3], [9, 8], [0, 0], [0, 8], [-1, 0]]) {
            const {ours: mine} = await both(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber'), view({beforeCount: 0, afterCount: 0, offset: {offset, contentCount}})]})
            assert.deepEqual([mine.code, mine.controls.vlv], [76, {targetPosition: 0, contentCount: PEOPLE.length, result: 61}], `${offset}/${contentCount}`)
        }
        //Without its sort: OpenLDAP gives 76 as the view result too, the draft sortControlMissing (60)
        const unsorted: Answer = (await both(UNIT, {filter: PEOPLE_FILTER, controls: [view({beforeCount: 0, afterCount: 1, offset: {offset: 1, contentCount: 0}})]})).ours
        assert.deepEqual([unsorted.code, (unsorted.controls.vlv as {result: number}).result], [76, 60])
        //A context ID the server never gave: OpenLDAP ignores it, the draft fails the search with protocolError
        const context: Answer = (await both(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber'), view({beforeCount: 0, afterCount: 1, offset: {offset: 1, contentCount: 0}, contextId: Buffer.from('nonsense')})]})).ours
        assert.deepEqual([context.code, (context.controls.vlv as {result: number}).result], [76, 2])
        //The window of the client past the last entry, on either: no entries, the count of the server
        for (const connection of [ours, theirs]) assert.deepEqual(await connection.search(UNIT, {scope: 'one', filter: PEOPLE_FILTER, sort: [{attribute: 'uidNumber'}], window: {offset: 20, limit: 5}}).then((result) => [result.entries.length, result.total]), [0, PEOPLE.length])
    })

    it('gives the result of the sort with every page', async () => {
        const pages = async (connection: LDAPClientConnection): Promise<unknown[]> => {
            let cookie: Buffer = Buffer.alloc(0)
            const answers: unknown[] = []
            do {
                const result = await connection.search(UNIT, {scope: 'one', filter: PEOPLE_FILTER, attributes: ['1.1'], paged: false, controls: [sort('uidNumber'), PagedResultsControl.encode({size: 3, cookie})]})
                answers.push({dns: result.entries.map((entry) => entry.dn.toLowerCase()), ...decoded(result.controls)})
                cookie = PagedResultsControl.decode(result.controls.find((control) => control.oid === PagedResultsControl.oid)!).cookie
            } while (cookie.length)
            return answers
        }
        assert.deepEqual(await pages(ours), await pages(theirs))
    })

    it('answers a control value it cannot read, and a page size it cannot take, with protocolError', async () => {
        for (const critical of [true, false]) {
            await alike(UNIT, {filter: PEOPLE_FILTER, controls: [raw(SortRequestControl.oid, [0x30, 0x03, 0x04], critical)]})
            await alike(UNIT, {filter: PEOPLE_FILTER, controls: [raw(PagedResultsControl.oid, [0x02, 0x01], critical)]})
        }
        await alike(UNIT, {filter: PEOPLE_FILTER, controls: [sort('uidNumber'), raw(VLVRequestControl.oid, [0x30, 0x00])]})
        await alike(UNIT, {filter: PEOPLE_FILTER, controls: [PagedResultsControl.encode({size: -1, cookie: Buffer.alloc(0)})]})
        //A first page of size 0: no entry, a cookie while entries are left
        await alike(UNIT, {filter: PEOPLE_FILTER, controls: [PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)})]})
    })

    it('answers the searches of the root alike', async () => {
        await alike('', {scope: 'sub', attributes: ['1.1'], sizeLimit: 3})
        await alike('', {scope: 'one', attributes: ['1.1']})
        await alike('', {scope: 'base', attributes: ['1.1'], filter: '(objectClass=person)'})
        for (const controls of [[raw('1.3.6.1.4.1.99999.7', [], true)], [{...sort('uidNumber'), critical: true}], [sort('uidNumber'), view({beforeCount: 0, afterCount: 2, offset: {offset: 1, contentCount: 0}}, true)]]) await alike('', {scope: 'base', attributes: ['1.1'], controls})
        //A critical sort of the subschema: OpenLDAP answers inappropriateMatching (cn has no ordering rule there), the
        //engine unavailableCriticalExtension (RFC 2891, scenario 3)
        assert.equal((await both('cn=Subschema', {scope: 'base', attributes: ['1.1'], controls: [{...sort('cn'), critical: true}]})).ours.code, 12)
    })

    it('answers a plain search alike', async () => {
        const {ours: mine, theirs: other} = await both(UNIT, {filter: '(objectClass=inetOrgPerson)'})
        assert.deepEqual({...mine, dns: [...mine.dns].sort()}, {...other, dns: [...other.dns].sort()})
        assert.equal(mine.dns.length, PEOPLE.length)
    })
})
