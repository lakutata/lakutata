/**
 * Ported from address/test/domain.ts (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Punycode from 'node:punycode'

import { analyzeDomain, errorCodes, isDomainValid, DomainOptions, validateDomainOptions } from '../../../lib/validation/engine/address/index.js'


describe('domain', () => {
    describe('analyze()', () => {
        it('requires a string', () => {
            expect(() => analyzeDomain(123 as any)).to.throw('Invalid input: domain must be a string')
        })

        it('identifies error', () => {
            const tests: [string, string, DomainOptions?][] = [
                ['', 'Domain must be a non-empty string'],
                ['êiana.org', 'Domain contains forbidden Unicode characters', { allowUnicode: false }],
                [
                    'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz.com',
                    'Domain too long'
                ],
                ['com', 'Domain lacks the minimum required number of segments'],
                ['x.no-such-tld', 'Domain uses forbidden TLD', { tlds: { allow: new Set(['com']) } }],
                ['example..com', 'Domain contains empty dot-separated segment'],
                [
                    '1234567890123456789012345678901234567890123456789012345678901234567890.com',
                    'Domain contains dot-separated segment that is too long'
                ],
                ['example+.com', 'Domain contains invalid character'],
                ['example.com_', 'Domain contains invalid tld character']
            ]

            for (const [domain, message, options] of tests) {
                const output = analyzeDomain(domain, options)

                if (!output || output.error !== message) {
                    console.log(domain)
                }

                expect(output?.error).to.equal(message)
                expect(errorCodes[output?.code]).to.equal(output?.error)
            }
        })

        it('does not throw on null', () => {
            expect(() => analyzeDomain(null)).to.not.throw()
            expect(() => analyzeDomain(undefined)).to.not.throw()
        })
    })

    describe('validateDomainOptions()', () => {
        it('validates options', () => {
            expect(() => validateDomainOptions(null)).to.not.throw()
            expect(() => validateDomainOptions({ tlds: { deny: new Set(['test']) } })).to.not.throw()
            expect(() => validateDomainOptions({ tlds: { allow: new Set(['test']) } })).to.not.throw()

            const tests: [string, any][] = [
                ['Invalid options: tlds must be a boolean or an object', { tlds: 1 }],
                ['Invalid options: tlds.allow must be a Set object or true', { tlds: { allow: ['test'] } }],
                ['Invalid options: tlds.deny must be a Set object', { tlds: { deny: ['test'] } }],
                [
                    'Invalid options: cannot specify both tlds.allow and tlds.deny lists',
                    { tlds: { allow: new Set(), deny: new Set() } }
                ]
            ]

            for (const [message, options] of tests) {
                expect(() => validateDomainOptions(options)).to.throw(message)
            }
        })
    })

    describe('isValid()', () => {
        it('validates domain', () => {
            const tests: [string, boolean, DomainOptions?][] = [
                ['\r', false],
                ['test', false],
                ['@', false],
                ['iana.org', true],
                ['nominet.org.uk', true],
                ['about.museum', true],
                ['x.商務', true, { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }],
                ['iana.123', false],
                ['255.255.255.255', false],
                ['XN--UNUP4Y', true, { minDomainSegments: 1 }],
                ['XN--UNUP4Y', true, { minDomainSegments: 1, maxDomainSegments: 1 }],
                ['test@example.com', false],
                ['test:example.com', false],
                ['example.com:123', false],
                ['example.com/path', false],
                ['x.example.com', false, { maxDomainSegments: 2 }],
                ['x.example.com', true, { maxDomainSegments: 3 }],
                ['example.com/', false],
                ['example.com\\', false],
                ['example.com?', false],
                ['example.com#', false],
                ['example.com:', false],
                ['example.com&', false],
                ['example.com|', false],
                ['example.com%2e', false],
                ['example.com.', false],
                ['example.com.', true, { allowFullyQualified: true }],
                ['example.com', true, { allowFullyQualified: true }],
                ['_acme-challenge.example.com', false],
                ['_acme-challenge.example.com', true, { allowUnderscore: true }],
                ['_acme-challenge.example.com', false, { allowUnderscore: false }],
                ['_abc.example.com', true, { allowUnderscore: true }],
                ['_abc.example.com', false],
                ['_example.com', true, { allowUnderscore: true }],
                ['_example.com', false],
                ['_abc.{example}.com', false, { allowUnderscore: true }]
            ]

            for (let i = 0; i < tests.length; ++i) {
                const domain = tests[i]
                const valid = isDomainValid(domain[0], domain[2])
                const result = domain[1]

                if (valid !== result) {
                    const outcome = analyzeDomain(domain[0], domain[2])
                    if (outcome) {
                        console.log(i, domain[0], outcome.error)
                    } else {
                        console.log(i, domain[0])
                    }
                }

                expect(valid).to.equal(result)
            }
        })
    })
})
