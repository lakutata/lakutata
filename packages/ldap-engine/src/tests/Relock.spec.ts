import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createLDAPServer, type LDAPInProcessConnection, type LDAPInterceptor, type LDAPServerEngine, type PartialAttribute} from '../exports/LDAPEngine.js'
import {LockingBackend} from './support/LockingBackend.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = `cn=admin,${BASE}`
const DEVICE: string = `cn=device,${BASE}`

/**
 * A server on a locking backend, with interceptors, an entry to modify
 * @param interceptors The interceptors.
 */
async function serve(interceptors: LDAPInterceptor[]): Promise<{server: LDAPServerEngine, backend: LockingBackend, admin: LDAPInProcessConnection}> {
    const backend: LockingBackend = new LockingBackend(BASE)
    const server: LDAPServerEngine = createLDAPServer({backends: [backend], access: {admins: [ADMIN]}, interceptors: interceptors})
    const admin: LDAPInProcessConnection = server.connect({as: ADMIN})
    await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await admin.add(DEVICE, {objectClass: 'device', cn: 'device', serialNumber: '7'})
    return {server, backend, admin}
}

describe('a modify made again from the entry locked', () => {
    it('keeps what the interceptors after the schema step made of the changes: removed, edited, added', async () => {
        const {backend, admin} = await serve([{name: 'editing', operations: ['modify'], before: (_context, request) => {
            if (request.type !== 'modify') return
            //A change removed, a value edited in place, a change added
            request.changes = request.changes.filter((change: {attribute: PartialAttribute}): boolean => change.attribute.type.toLowerCase() !== 'description')
            for (const change of request.changes) {
                if (change.attribute.type.toLowerCase() === 'l') change.attribute.values = change.attribute.values.map((value: Buffer): Buffer => Buffer.from(value.toString().toUpperCase()))
            }
            request.changes.push({operation: 'add', attribute: {type: 'seeAlso', values: [Buffer.from(BASE)]}})
        }}])
        const before: string | undefined = (await admin.search(DEVICE, {scope: 'base', attributes: ['modifyTimestamp']})).entries[0].first('modifyTimestamp')
        await new Promise((resolve) => setTimeout(resolve, 1100))
        backend.locked.length = 0
        await admin.modify(DEVICE, [{operation: 'add', attribute: 'description', values: 'removed'}, {operation: 'add', attribute: 'l', values: 'paris'}])
        assert.deepEqual(backend.locked, [DEVICE])
        const entry = (await admin.search(DEVICE, {scope: 'base', attributes: ['*', 'modifyTimestamp']})).entries[0]
        assert.deepEqual([entry.get('description'), entry.get('l'), entry.get('seeAlso')], [[], ['PARIS'], [BASE]])
        assert.notEqual(entry.first('modifyTimestamp'), before)
    })

    it('makes the increments the interceptors leave from the entry locked, not those they removed', async () => {
        const {admin} = await serve([{name: 'dropping', operations: ['modify'], before: (_context, request) => {
            if (request.type !== 'modify') return
            //The first of two increments of one attribute removed
            const first: number = request.changes.findIndex((change: {attribute: PartialAttribute}): boolean => change.attribute.type.toLowerCase() === 'serialnumber')
            if (first >= 0) request.changes.splice(first, 1)
        }}])
        await admin.modify(DEVICE, [{operation: 'replace', attribute: 'serialNumber', values: '10'}, {operation: 'increment', attribute: 'serialNumber', values: '5'}])
        assert.deepEqual((await admin.search(DEVICE, {scope: 'base'})).entries[0].get('serialNumber'), ['12'])
    })
})
