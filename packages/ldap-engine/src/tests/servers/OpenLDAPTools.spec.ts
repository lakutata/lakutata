//The server against the command line tools of OpenLDAP, run in a container (test-env/openldap/tools.sh gives its name)
//reaching the server on this machine as host.docker.internal; skipped without it. With LDAP_TOOLS_SOCKETS (a directory)
//and LDAP_TOOLS_IMAGE, the server listens on a Unix socket there too, which containers of the image mount (Docker
//Desktop passes on a socket mounted as a file, not one made later in a mounted directory)
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {after, before, describe, it} from 'node:test'
import {createLDAPServer, type LDAPServerEngine, MemoryBackend} from '../../exports/LDAPEngine.js'
import {CERTIFICATE, KEY} from '../support/Certificate.js'

const CONTAINER: string | undefined = process.env.LDAP_TOOLS_CONTAINER
const HOST: string = process.env.LDAP_TOOLS_HOST ?? 'host.docker.internal'
const LISTEN: string = process.env.LDAP_TOOLS_LISTEN ?? '127.0.0.1'
const SOCKETS: string | undefined = process.env.LDAP_TOOLS_SOCKETS
const IMAGE: string | undefined = process.env.LDAP_TOOLS_IMAGE
const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'

/**
 * Run a tool in the container: its exit code and its output
 * @param tool The tool.
 * @param args Its arguments.
 * @param input Its standard input.
 */
function run(tool: string, args: string[], input?: string): Promise<{code: number, stdout: string, stderr: string}> {
    return new Promise((resolve) => {
        //The CA of the test certificate, written by before(); its name is not host.docker.internal, so it is not checked
        const child = execFile('docker', ['exec', '-i', '-e', 'LDAPTLS_REQCERT=never', '-e', 'LDAPTLS_CACERT=/tmp/ca.pem', CONTAINER!, tool, ...args], {timeout: 30000}, (error, stdout, stderr) => {
            resolve({code: error ? (typeof (error as {code?: unknown}).code === 'number' ? (error as {code: number}).code : 1) : 0, stdout: stdout, stderr: stderr})
        })
        child.stdin?.end(input ?? '')
    })
}

/**
 * Run a tool in a container of its own mounting the Unix socket of the server as /run/ldapi: its exit code and its output
 * @param tool The tool.
 * @param args Its arguments.
 */
function runOnSocket(tool: string, args: string[]): Promise<{code: number, stdout: string, stderr: string}> {
    return new Promise((resolve) => {
        execFile('docker', ['run', '--rm', '-v', `${SOCKETS}/ldapi:/run/ldapi`, '--entrypoint', tool, IMAGE!, ...args], {timeout: 60000}, (error, stdout, stderr) => {
            resolve({code: error ? (typeof (error as {code?: unknown}).code === 'number' ? (error as {code: number}).code : 1) : 0, stdout: stdout, stderr: stderr})
        })
    })
}

describe('against the command line tools of OpenLDAP', {skip: !CONTAINER}, () => {
    let server: LDAPServerEngine
    let ldap: string
    let ldaps: string
    const admin = (): string[] => ['-x', '-H', ldap, '-D', ADMIN, '-w', 'secret']

    before(async () => {
        await run('sh', ['-c', 'cat > /tmp/ca.pem'], CERTIFICATE)
        server = createLDAPServer({
            backends: [new MemoryBackend(BASE)],
            access: {admins: [ADMIN]},
            passwords: {iterations: 1000},
            tls: {cert: CERTIFICATE, key: KEY},
            limits: {sizeLimit: 3}
        })
        const directory = server.connect({as: ADMIN})
        await directory.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
        await directory.add(ADMIN, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'admin', userPassword: 'secret'})
        const port: number = await server.listen({port: 0, host: LISTEN})
        const securePort: number = await server.listen({port: 0, host: LISTEN, secure: true})
        ldap = `ldap://${HOST}:${port}`
        ldaps = `ldaps://${HOST}:${securePort}`
        if (SOCKETS) await server.listen({path: `${SOCKETS}/ldapi`, mode: 0o666})
    })

    after(async () => {
        await server?.close()
    })

    it('says who is bound: ldapwhoami over LDAP, StartTLS and LDAPS, and with the password policy control', async () => {
        assert.equal((await run('ldapwhoami', admin())).stdout.trim(), `dn:${ADMIN}`)
        const startTLS = await run('ldapwhoami', [...admin(), '-ZZ'])
        assert.equal(startTLS.stdout.trim(), `dn:${ADMIN}`, startTLS.stderr)
        assert.equal((await run('ldapwhoami', ['-x', '-H', ldaps, '-D', ADMIN, '-w', 'secret'])).stdout.trim(), `dn:${ADMIN}`)
        assert.equal((await run('ldapwhoami', [...admin(), '-e', 'ppolicy'])).stdout.trim().split('\n').pop(), `dn:${ADMIN}`)
        assert.equal((await run('ldapwhoami', ['-x', '-H', ldap])).stdout.trim(), 'anonymous')
        const wrong = await run('ldapwhoami', ['-x', '-H', ldap, '-D', ADMIN, '-w', 'wrong'])
        assert.equal(wrong.code, 49)
        assert.match(wrong.stderr, /Invalid credentials \(49\)/)
    })

    it('adds entries with ldapadd, the errors with their codes', async () => {
        const ldif: string = [
            `dn: ou=people,${BASE}`, 'objectClass: organizationalUnit', 'ou: people', '',
            ...[1, 2, 3, 4, 5].flatMap((index) => [`dn: uid=user${index},ou=people,${BASE}`, 'objectClass: inetOrgPerson', `uid: user${index}`, `cn: User ${6 - index}`, 'sn: Test', `mail: user${index}@example.com`, `userPassword: password${index}`, '']),
            `dn: cn=team,${BASE}`, 'objectClass: groupOfNames', 'cn: team', `member: uid=user1,ou=people,${BASE}`, ''
        ].join('\n')
        const added = await run('ldapadd', admin(), ldif)
        assert.equal(added.code, 0, added.stderr)
        const again = await run('ldapadd', admin(), `dn: uid=user1,ou=people,${BASE}\nobjectClass: inetOrgPerson\nuid: user1\ncn: x\nsn: x\n`)
        assert.equal(again.code, 68)
        assert.match(again.stderr, /Already exists \(68\)/)
        const invalid = await run('ldapadd', admin(), `dn: uid=bad,ou=people,${BASE}\nobjectClass: inetOrgPerson\nuid: bad\ncn: x\n`)
        assert.equal(invalid.code, 65)
    })

    it('searches with ldapsearch: filters, attributes, paged results, sorting, the virtual list view, the size limit', async () => {
        const found = await run('ldapsearch', [...admin(), '-LLL', '-b', BASE, '(mail=USER2@example.com)', 'cn', 'mail'])
        assert.equal(found.code, 0, found.stderr)
        assert.match(found.stdout, new RegExp(`dn: uid=user2,ou=people,${BASE}\\ncn: User 4\\nmail: user2@example.com`))
        const user = ['-x', '-H', ldap, '-D', `uid=user1,ou=people,${BASE}`, '-w', 'password1']
        const limited = await run('ldapsearch', [...user, '-LLL', '-b', `ou=people,${BASE}`, '-s', 'one', '1.1'])
        assert.equal(limited.code, 4)
        //Paged: the pages together within the size limit, as OpenLDAP counts them (size.prtotal)
        const paged = await run('ldapsearch', [...user, '-LLL', '-b', `ou=people,${BASE}`, '-s', 'one', '-E', 'pr=2/noprompt', '1.1'])
        assert.equal(paged.code, 4, paged.stderr)
        assert.equal((paged.stdout.match(/^dn: /gm) ?? []).length, 3)
        const sorted = await run('ldapsearch', [...admin(), '-LLL', '-b', `ou=people,${BASE}`, '-s', 'one', '-E', 'sss=cn', 'cn'])
        assert.deepEqual([...sorted.stdout.matchAll(/^cn: (.*)$/gm)].map((match) => match[1]), ['User 1', 'User 2', 'User 3', 'User 4', 'User 5'])
        const window = await run('ldapsearch', [...admin(), '-LLL', '-b', `ou=people,${BASE}`, '-s', 'one', '-E', 'sss=cn', '-E', 'vlv=0/1/2/0', 'cn'])
        //ldapsearch asks for the next window on its input, closed: the first window is before the first result
        const first: string = window.stdout.split('# sortResult')[0]
        assert.deepEqual([...first.matchAll(/^cn: (.*)$/gm)].map((match) => match[1]), ['User 2', 'User 3'], window.stdout + window.stderr)
        assert.match(window.stdout, /# vlvResultpos=2 count=5/)
        const root = await run('ldapsearch', ['-x', '-H', ldap, '-LLL', '-b', '', '-s', 'base', '+'])
        assert.match(root.stdout, /namingContexts: dc=example,dc=com/)
        assert.match(root.stdout, /supportedExtension: 1\.3\.6\.1\.4\.1\.1466\.20037/)
        const schema = await run('ldapsearch', ['-x', '-H', ldap, '-LLL', '-b', 'cn=Subschema', '-s', 'base', 'objectClasses'])
        assert.match(schema.stdout, /NAME 'inetOrgPerson'/)
        const anonymous = await run('ldapsearch', ['-x', '-H', ldap, '-LLL', '-b', BASE])
        assert.equal(anonymous.code, 50)
    })

    it('modifies, compares, renames and deletes with ldapmodify, ldapcompare, ldapmodrdn and ldapdelete', async () => {
        const modified = await run('ldapmodify', admin(), `dn: uid=user3,ou=people,${BASE}\nchangetype: modify\nreplace: mail\nmail: three@example.com\n-\nadd: description\ndescription: the third\n`)
        assert.equal(modified.code, 0, modified.stderr)
        assert.equal((await run('ldapcompare', [...admin(), `uid=user3,ou=people,${BASE}`, 'mail:THREE@example.com'])).code, 6)
        assert.equal((await run('ldapcompare', [...admin(), `uid=user3,ou=people,${BASE}`, 'mail:user3@example.com'])).code, 5)
        const renamed = await run('ldapmodrdn', [...admin(), '-r', `uid=user5,ou=people,${BASE}`, 'uid=user6'])
        assert.equal(renamed.code, 0, renamed.stderr)
        const after = await run('ldapsearch', [...admin(), '-LLL', '-b', `uid=user6,ou=people,${BASE}`, '-s', 'base', 'uid'])
        assert.match(after.stdout, /^uid: user6$/m)
        assert.doesNotMatch(after.stdout, /^uid: user5$/m)
        const leaf = await run('ldapdelete', [...admin(), `ou=people,${BASE}`])
        assert.equal(leaf.code, 66)
        await run('ldapadd', admin(), `dn: ou=temp,${BASE}\nobjectClass: organizationalUnit\nou: temp\n\ndn: cn=inside,ou=temp,${BASE}\nobjectClass: device\ncn: inside\n`)
        const recursive = await run('ldapdelete', [...admin(), '-r', `ou=temp,${BASE}`])
        assert.equal(recursive.code, 0, recursive.stderr)
        assert.equal((await run('ldapsearch', [...admin(), '-LLL', '-b', `ou=temp,${BASE}`, '-s', 'base'])).code, 32)
    })

    it('changes passwords with ldappasswd, generated or given, and runs extended operations with ldapexop', async () => {
        const given = await run('ldappasswd', [...admin(), '-s', 'chosen', `uid=user4,ou=people,${BASE}`])
        assert.equal(given.code, 0, given.stderr)
        assert.equal((await run('ldapwhoami', ['-x', '-H', ldap, '-D', `uid=user4,ou=people,${BASE}`, '-w', 'chosen'])).stdout.trim(), `dn:uid=user4,ou=people,${BASE}`)
        const generated = await run('ldappasswd', [...admin(), `uid=user2,ou=people,${BASE}`])
        const password: string | undefined = /New password: (\S+)/.exec(generated.stdout)?.[1]
        assert.ok(password, generated.stdout + generated.stderr)
        assert.equal((await run('ldapwhoami', ['-x', '-H', ldap, '-D', `uid=user2,ou=people,${BASE}`, '-w', password!])).code, 0)
        const own = await run('ldappasswd', ['-x', '-H', ldap, '-D', `uid=user1,ou=people,${BASE}`, '-w', 'password1', '-a', 'password1', '-s', 'mine'])
        assert.equal(own.code, 0, own.stderr)
        assert.equal((await run('ldapexop', [...admin(), 'whoami'])).stdout.trim(), `dn:${ADMIN}`)
        //ldapexop exits with 1 whatever the result code, which it prints
        const unknown = await run('ldapexop', [...admin(), '1.2.3.4'])
        assert.match(unknown.stderr, /Protocol error \(2\)/)
    })

    it('serves the tools over a Unix socket (ldapi): a simple bind, SASL PLAIN, and no EXTERNAL offered', {skip: !SOCKETS || !IMAGE}, async () => {
        const ldapi: string = 'ldapi://%2Frun%2Fldapi'
        const simple = await runOnSocket('ldapwhoami', ['-x', '-H', ldapi, '-D', ADMIN, '-w', 'secret'])
        assert.equal(simple.stdout.trim(), `dn:${ADMIN}`, simple.stderr)
        const root = await runOnSocket('ldapsearch', ['-x', '-H', ldapi, '-LLL', '-b', '', '-s', 'base', 'supportedSASLMechanisms'])
        assert.equal(root.code, 0, root.stderr)
        assert.deepEqual(root.stdout.split('\n').filter((line) => line.startsWith('supportedSASLMechanisms:')), ['supportedSASLMechanisms: PLAIN'])
        const plain = await runOnSocket('ldapwhoami', ['-H', ldapi, '-Y', 'PLAIN', '-U', `dn:${ADMIN}`, '-w', 'secret'])
        assert.equal(plain.stdout.trim(), `dn:${ADMIN}`, plain.stderr)
    })
})
