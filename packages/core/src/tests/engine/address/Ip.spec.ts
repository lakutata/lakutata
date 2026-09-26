/**
 * Ported from address/test/ip.ts (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'

import { ipRegex } from '../../../lib/validation/engine/address/index.js'


describe('ip', () => {
    it('errors on invalid options', () => {
        expect(() => ipRegex({ cidr: 'unknown' } as any)).to.throw(
            'options.cidr must be one of required, optional, forbidden'
        )
        expect(() => ipRegex({ cidr: 1 } as any)).to.throw('options.cidr must be one of required, optional, forbidden')

        expect(() => ipRegex({ version: 1 } as any)).to.throw('options.version must be a string or an array of string')
        expect(() => ipRegex({ version: [1] } as any)).to.throw('Invalid options.version value')
        expect(() => ipRegex({ version: [] })).to.throw('options.version must have at least 1 version specified')
        expect(() => ipRegex({ version: 'unknown' } as any)).to.throw(
            'options.version contains unknown version unknown - must be one of ipv4, ipv6, ipvfuture'
        )
    })

    it('normalizes options', () => {
        expect(ipRegex().versions).to.equal(['ipv4', 'ipv6', 'ipvfuture'])
        expect(ipRegex({ version: 'ipv4' }).versions).to.equal(['ipv4'])

        expect(ipRegex({ cidr: 'required' }).cidr).to.equal('required')
        expect(ipRegex().cidr).to.equal('optional')
    })

    it('returns raw expression', () => {
        expect(ipRegex({ version: 'ipv4' }).raw).to.equal(
            '(?:(?:(?:0{0,2}\\d|0?[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-5])\\.){3}(?:0{0,2}\\d|0?[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-5])(?:\\/(?:\\d|[1-2]\\d|3[0-2]))?)'
        )
    })

    const invalidIPs = [
        'ASDF',
        '192.0.2.16:80/30',
        '192.0.2.16a',
        'qwerty',
        '127.0.0.1:8000',
        'ftp://www.example.com',
        'Bananas in pajamas are coming down the stairs'
    ]

    const invalidIPv4s = [
        '0.0.0.0/33',
        '256.0.0.0/0',
        '255.255.255.256/32',
        '255.255.255.255/64',
        '255.255.255.255/128',
        '255.255.255.255/255',
        '256.0.0.0',
        '255.255.255.256'
    ]

    const invalidIPv6s = [
        '1080:0:0:0:8:800:200C:417G/33',
        '1080:0:0:0:8:800:200C:417G',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210/129',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210/255'
    ]

    const invalidIPvFutures = ['v1.09#/33', 'v1.09#', "v1.09azAZ-._~!$&'()*+,;=:/129", "v1.09azAZ-._~!$&'()*+,;=:/255"]

    const validIPv4sWithCidr = [
        '0.0.0.0/32',
        '255.255.255.255/0',
        '127.0.0.1/0',
        '192.168.2.1/0',
        '0.0.0.3/2',
        '0.0.0.7/3',
        '0.0.0.15/4',
        '0.0.0.31/5',
        '0.0.0.63/6',
        '0.0.0.127/7',
        '01.020.030.100/7',
        '0.0.0.0/0',
        '00.00.00.00/0',
        '000.000.000.000/32'
    ]

    const validIPv4sWithoutCidr = [
        '0.0.0.0',
        '255.255.255.255',
        '127.0.0.1',
        '192.168.2.1',
        '0.0.0.3',
        '0.0.0.7',
        '0.0.0.15',
        '0.0.0.31',
        '0.0.0.63',
        '0.0.0.127',
        '01.020.030.100',
        '0.0.0.0',
        '00.00.00.00',
        '000.000.000.000'
    ]

    const validIPv6sWithCidr = [
        '2001:db8::7/32',
        'a:b:c:d:e::1.2.3.4/13',
        'a:b:c:d:e::1.2.3.4/64',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210/0',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210/32',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210/128',
        '1080:0:0:0:8:800:200C:417A/27'
    ]

    const validIPv6sWithoutCidr = [
        '2001:db8::7',
        'a:b:c:d:e::1.2.3.4',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210',
        'FEDC:BA98:7654:3210:FEDC:BA98:7654:3210',
        '1080:0:0:0:8:800:200C:417A',
        '::1:2:3:4:5:6:7',
        '::1:2:3:4:5:6',
        '1::1:2:3:4:5:6',
        '::1:2:3:4:5',
        '1::1:2:3:4:5',
        '2:1::1:2:3:4:5',
        '::1:2:3:4',
        '1::1:2:3:4',
        '2:1::1:2:3:4',
        '3:2:1::1:2:3:4',
        '::1:2:3',
        '1::1:2:3',
        '2:1::1:2:3',
        '3:2:1::1:2:3',
        '4:3:2:1::1:2:3',
        '::1:2',
        '1::1:2',
        '2:1::1:2',
        '3:2:1::1:2',
        '4:3:2:1::1:2',
        '5:4:3:2:1::1:2',
        '::1',
        '1::1',
        '2:1::1',
        '3:2:1::1',
        '4:3:2:1::1',
        '5:4:3:2:1::1',
        '6:5:4:3:2:1::1',
        '::',
        '1::',
        '2:1::',
        '3:2:1::',
        '4:3:2:1::',
        '5:4:3:2:1::',
        '6:5:4:3:2:1::',
        '7:6:5:4:3:2:1::'
    ]

    const validIPvFuturesWithCidr = ["v1.09azAZ-._~!$&'()*+,;=:/32", "v1.09azAZ-._~!$&'()*+,;=:/128"]

    const validIPvFuturesWithoutCidr = ["v1.09azAZ-._~!$&'()*+,;=:"]

    const validate = (options, pass, tests) => {
        const { regex } = ipRegex(options)

        for (let i = 0; i < tests.length; ++i) {
            const ip = tests[i]
            const match = regex.test(ip)

            if (match !== pass) {
                console.log(i, ip)
            }

            expect(match).to.equal(pass)
        }
    }

    it('validates IP addresses with optional CIDR by default', () => {
        const options = {}

        validate(options, true, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, true, validIPvFuturesWithCidr)
        validate(options, true, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates IP addresses with an optional CIDR', () => {
        const options = { cidr: 'optional' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, true, validIPvFuturesWithCidr)
        validate(options, true, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates IP addresses with a required CIDR', () => {
        const options = { cidr: 'required' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, true, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates IP addresses with a forbidden CIDR', () => {
        const options = { cidr: 'forbidden' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, true, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 addresses with a default CIDR strategy', () => {
        const options = { version: 'ipv4' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 addresses with an optional CIDR', () => {
        const options = { version: 'ipv4' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 addresses with a required CIDR', () => {
        const options = { version: 'ipv4', cidr: 'required' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 addresses with a forbidden CIDR', () => {
        const options = { version: 'ipv4', cidr: 'forbidden' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv6 addresses with a default CIDR strategy', () => {
        const options = { version: 'ipv6' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv6 addresses with an optional CIDR', () => {
        const options = { version: 'ipv6', cidr: 'optional' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv6 addresses with a required CIDR', () => {
        const options = { version: 'ipv6', cidr: 'required' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv6 addresses with a forbidden CIDR', () => {
        const options = { version: 'ipv6', cidr: 'forbidden' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipvfuture addresses with a default CIDR strategy', () => {
        const options = { version: 'ipvfuture' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, true, validIPvFuturesWithCidr)
        validate(options, true, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipvfuture addresses with an optional CIDR', () => {
        const options = { version: 'ipvfuture', cidr: 'optional' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, true, validIPvFuturesWithCidr)
        validate(options, true, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipvfuture addresses with a required CIDR', () => {
        const options = { version: 'ipvfuture', cidr: 'required' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, true, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipvfuture addresses with a forbidden CIDR', () => {
        const options = { version: 'ipvfuture', cidr: 'forbidden' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, true, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 and ipv6 addresses with an optional CIDR', () => {
        const options = { version: ['ipv4', 'ipv6'], cidr: 'optional' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 and ipv6 addresses with a required CIDR', () => {
        const options = { version: ['ipv4', 'ipv6'], cidr: 'required' }

        validate(options, true, validIPv4sWithCidr)
        validate(options, false, validIPv4sWithoutCidr)
        validate(options, true, validIPv6sWithCidr)
        validate(options, false, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })

    it('validates ipv4 and ipv6 addresses with a forbidden CIDR', () => {
        const options = { version: ['ipv4', 'ipv6'], cidr: 'forbidden' }

        validate(options, false, validIPv4sWithCidr)
        validate(options, true, validIPv4sWithoutCidr)
        validate(options, false, validIPv6sWithCidr)
        validate(options, true, validIPv6sWithoutCidr)
        validate(options, false, validIPvFuturesWithCidr)
        validate(options, false, validIPvFuturesWithoutCidr)
        validate(options, false, invalidIPs)
        validate(options, false, invalidIPv4s)
        validate(options, false, invalidIPv6s)
        validate(options, false, invalidIPvFutures)
    })
})
