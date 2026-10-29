//The events of a NetworkInterface on Linux, with a dummy interface the script creates and changes (root, NET_ADMIN):
//it appears, comes up, gets an IPv4 and an IPv6 address, loses one, goes down, disappears. Each change has to give its
//event within 5 seconds. Run in a container: node test-env/linux/events.mjs
import {execFileSync} from 'node:child_process'
import {NetworkInterface} from '../../dist/esm/exports/Netif.js'

const NAME = 'netif-dummy0'
const followed = new NetworkInterface(NAME)
const events = []
for (const name of ['added', 'removed', 'up', 'down']) followed.on(name, () => events.push({name}))
followed.on('change', change => events.push({name: 'change', added: change.added.map(address => address.cidr), removed: change.removed.map(address => address.cidr)}))

function ip(...args) {
    execFileSync('ip', args, {stdio: 'inherit'})
}

async function expect(description, test) {
    const started = Date.now()
    while (Date.now() - started < 5000) {
        const found = events.findIndex(test)
        if (found >= 0) {
            events.splice(0, found + 1)
            console.log(`ok   ${description} (${Date.now() - started} ms)`)
            return
        }
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    console.log(`FAIL ${description}: ${JSON.stringify(events)}`)
    process.exitCode = 1
}

try {
    if (followed.present) throw new Error(`${NAME} exists already`)
    ip('link', 'add', NAME, 'type', 'dummy')
    await expect('added', event => event.name === 'added')
    ip('link', 'set', NAME, 'up')
    await expect('up', event => event.name === 'up')
    ip('addr', 'add', '10.77.0.1/24', 'dev', NAME)
    await expect('IPv4 address added', event => event.name === 'change' && event.added.includes('10.77.0.1/24'))
    ip('-6', 'addr', 'add', 'fd77::1/64', 'dev', NAME)
    await expect('IPv6 address added, once usable', event => event.name === 'change' && event.added.includes('fd77::1/64'))
    if (!followed.addresses.some(address => address.address === 'fd77::1')) throw new Error('fd77::1 not among the addresses')
    ip('addr', 'del', '10.77.0.1/24', 'dev', NAME)
    await expect('IPv4 address removed', event => event.name === 'change' && event.removed.includes('10.77.0.1/24'))
    ip('link', 'set', NAME, 'down')
    await expect('down', event => event.name === 'down')
    ip('link', 'del', NAME)
    await expect('removed', event => event.name === 'removed')
    if (followed.present || followed.addresses.length) throw new Error('still present after its removal')
} finally {
    followed.close()
}
