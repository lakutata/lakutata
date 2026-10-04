import {describe, it} from 'node:test'
import assert from 'node:assert'
import {IP, IPv4, IPv6} from '../exports/Utils.js'

describe('IPToolkit', (): void => {

    it('converts 0.0.0.0 into 0', (): void => {
        assert.strictEqual(IP.ip2long('0.0.0.0'), 0)
        assert.strictEqual(IP.ip2long('192.168.0.1'), 3232235521)
        assert.strictEqual(IP.ip2long('::1'), 1n)
        assert.strictEqual(IP.ip2long('not an ip'), false)
    })

    it('reads the prefix lengths strictly: an invalid one gives false, not an error', (): void => {
        for (const cidr of ['10.0.0.0/8.5', '10.0.0.0/ 8', '10.0.0.0/0x8', '10.0.0.0/24/3', '10.0.0.0/', '10.0.0.0/-1', '10.0.0.0/33', '10.0.0.0/1e1', '10.0.0.0']) {
            assert.strictEqual(IPv4.isCIDR(cidr), false, cidr)
            assert.strictEqual(IPv4.parseCIDR(cidr), false, cidr)
            assert.strictEqual(IPv4.contains(cidr, '10.0.0.1'), false, cidr)
            assert.strictEqual(IP.isCIDR(cidr), false, cidr)
            assert.strictEqual(IP.contains(cidr, '10.0.0.1'), false, cidr)
        }
        for (const cidr of ['::1/64.5', '::1/ 64', '::1/0x40', '::1/64/1', '::1/129']) {
            assert.strictEqual(IPv6.isCIDR(cidr), false, cidr)
            assert.strictEqual(IPv6.parseCIDR(cidr), false, cidr)
            assert.strictEqual(IPv6.contains(cidr, '::1'), false, cidr)
            assert.strictEqual(IP.isCIDR(cidr), false, cidr)
        }
        assert.strictEqual(IP.isConflict(['10.0.0.0/8.5', '10.0.0.0/8']), false)
        assert.strictEqual(IPv6.isConflict(['::1/64.5', '::1/64']), false)
        assert.strictEqual(IPv4.isCIDR('10.0.0.0/08'), true)
        assert.strictEqual(IPv6.isCIDR('2001:db8::/32'), true)
    })

    it('accepts the integer masks only, as numbers too', (): void => {
        assert.strictEqual(IPv4.isValidMask(24.5), false)
        assert.strictEqual(IPv4.isValidMask(NaN), false)
        assert.strictEqual(IPv4.isValidMask(24), true)
        assert.strictEqual(IPv4.toSubnetMask(24.5), false)
        assert.deepStrictEqual(IPv4.parseSubnet('192.168.0.1', 24), IPv4.parseCIDR('192.168.0.1/24'))
        assert.deepStrictEqual(IPv4.parseSubnet('192.168.0.1', '255.255.255.0'), IPv4.parseCIDR('192.168.0.1/24'))
        assert.strictEqual(IPv4.parseSubnet('192.168.0.1', 24.5), false)
    })

    it('trims the IPv6 addresses and keeps their zone index', (): void => {
        assert.strictEqual(IPv6.expandedForm('fe80::1%eth0'), 'fe80:0000:0000:0000:0000:0000:0000:0001%eth0')
        assert.strictEqual(IPv6.compressedForm('FE80:0000::0001%eth0'), 'fe80::1%eth0')
        assert.strictEqual(IPv6.expandedForm(' ::1 '), '0000:0000:0000:0000:0000:0000:0000:0001')
        assert.strictEqual(IPv6.compressedForm(' 2001:0db8::0001 '), '2001:db8::1')
        assert.strictEqual(IPv6.compressedForm('::%1'), '::%1')
        assert.strictEqual(IPv6.ip2long('fe80::1%eth0'), IPv6.ip2long('fe80::1'))
    })

    it('finds the IPv4-mapped IPv6 addresses in the IPv4 blocks', (): void => {
        assert.strictEqual(IP.contains('192.168.1.0/24', '::ffff:192.168.1.5'), true)
        assert.strictEqual(IP.contains('192.168.1.0/24', '::ffff:c0a8:105'), true)
        assert.strictEqual(IP.contains('192.168.1.0/24', '::ffff:192.168.2.5'), false)
        //Not mapped: another prefix than ::ffff:0:0/96
        assert.strictEqual(IP.contains('192.168.1.0/24', '::192.168.1.5'), false)
        assert.strictEqual(IP.contains('::ffff:0:0/96', '192.168.1.5'), false)
    })

    it('orders the ends of a range', (): void => {
        const range = new IPv4.ipRange(5, 1)
        assert.deepStrictEqual(range.ip2long(), [1, 5])
        assert.strictEqual(range.ipCount(), 5)
        assert.strictEqual(range.contains('0.0.0.3'), true)
        assert.throws((): unknown => IPv4.ipRange.fromLong(5, 1))
    })
})
