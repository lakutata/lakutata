/**
 * Ported from the upstream test/email.ts (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Punycode from 'node:punycode'

import { analyzeEmail, EmailOptions, errorCodes, isEmailValid } from '../../../lib/validation/engine/address/index.js'


describe('email', () => {
    describe('analyze()', () => {
        it('requires a string', () => {
            expect(() => analyzeEmail(123 as any)).to.throw('Invalid input: email must be a string')
        })

        it('identifies error', () => {
            const tests: [string, string, EmailOptions?][] = [
                ['', 'Address must be a non-empty string'],
                ['êjness@iana.org', 'Address contains forbidden Unicode characters', { allowUnicode: false }],
                ['test@test@test', 'Address cannot contain more than one @ character'],
                ['test', 'Address must contain one @ character'],
                ['@example.com', 'Address local part cannot be empty'],
                ['test@', 'Domain must be a non-empty string'],
                [
                    '1234567890@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz.com',
                    'Address too long'
                ],
                [
                    '1234567890123456789012345678901234567890123456789012345678901234567890@example.com',
                    'Address local part too long'
                ],
                ['x..y@example.com', 'Address local part contains empty dot-separated segment'],
                ['x:y@example.com', 'Address local part contains invalid character'],
                ['ê:y@example.com', 'Address local part contains invalid character'],
                ['test@com', 'Domain lacks the minimum required number of segments'],
                ['test@x.no-such-tld', 'Domain uses forbidden TLD', { tlds: { allow: new Set(['com']) } }],
                ['test@example..com', 'Domain contains empty dot-separated segment'],
                [
                    'test@1234567890123456789012345678901234567890123456789012345678901234567890.com',
                    'Domain contains dot-separated segment that is too long'
                ],
                ['test@example+.com', 'Domain contains invalid character'],
                ['test@example.com_', 'Domain contains invalid tld character'],
                ['test@example.com\\', 'Domain contains invalid character'],
                ['test@example.com#', 'Domain contains invalid character']
            ]

            for (const [email, message, options] of tests) {
                const output = analyzeEmail(email, options)

                if (!output || output.error !== message) {
                    console.log(email)
                }

                expect(output?.error).to.equal(message)
                expect(errorCodes[output.code]).to.equal(output?.error)
            }
        })

        describe('validated TLD', () => {
            it('denies listed tls', () => {
                expect(analyzeEmail('test@example.com', { tlds: { deny: new Set(['test']) } })).to.not.exist()
                expect(analyzeEmail('test@example.com', { tlds: { deny: new Set(['com']) } })).to.equal({
                    error: 'Domain uses forbidden TLD',
                    code: 'DOMAIN_FORBIDDEN_TLDS'
                })
            })
        })
    })

    describe('isValid()', () => {
        it('validates email', () => {
            // Tests adapted from https://github.com/skeggse/isemail
            // Copyright (c) 2008-2019, Eli Skeggs, Dominic Sayers, GlobeSherpa

            const tests: [string, boolean, EmailOptions?][] = [
                ['\r', false],
                ['test', false],
                ['@', false],
                ['test@', false],
                ['test@io', false],
                ['test@io', true, { minDomainSegments: 1 }],
                ['@io', false],
                ['@iana.org', false],
                ['test@iana.org', true],
                ['test@nominet.org.uk', true],
                ['test@about.museum', true],
                ['a@iana.org', true],
                ['êjness@iana.org', true],
                ['ñoñó1234@iana.org', true],
                ['ñoñó1234@something.com', true],
                ['伊昭傑@郵件.商務', true, { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }],
                ['\ud801\udc37\ud852\udf62@iana.org', true],
                ['test.test@iana.org', true],
                ['.test@iana.org', false],
                ['test.@iana.org', false],
                ['test..iana.org', false],
                ['test_exa-mple.com', false],
                ['!#$%&`*+/=?^`{|}~@iana.org', true],
                ['test\\@test@iana.org', false],
                ['123@iana.org', true],
                ['test@123.com', true],
                ['test@iana.123', false],
                ['test@255.255.255.255', false],
                ['abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklm@iana.org', true],
                ['abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklmn@iana.org', false],
                [
                    '\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06@iana.org',
                    false
                ],
                ['test@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklm', false],
                [
                    'test@\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06.org',
                    true
                ],
                [
                    'test@abcdefghijklmnopqrstuvwxyzabcdefghijklmno\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06.org',
                    false
                ],
                ['test@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklm.com', false],
                ['test@mason-dixon.com', true],
                ['test@-iana.org', false],
                ['test@iana-.com', false],
                ['test@.iana.org', false],
                ['test@iana.org.', false],
                ['test@iana..com', false],
                [
                    'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklm@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmno',
                    false
                ],
                [
                    'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklm@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.\ud83d\ude06\ud83d\ude06\ud83d\ude06\ud83d\ude06',
                    false,
                    { tlds: { allow: new Set(['com']) } }
                ],
                [
                    'abcdef@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef.hijklmnopqrstuv',
                    false
                ],
                [
                    'abcdef@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghi.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcd\ud83d\ude06',
                    false
                ],
                [
                    'abcdef@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghi.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz\ud83d\ude06',
                    false,
                    { tlds: { allow: new Set(['com']) } }
                ],
                [
                    'a@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijkl.hijk',
                    false,
                    { tlds: { allow: new Set(['com']) } }
                ],
                [
                    'a@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijkl.\ud83d\ude06',
                    false,
                    { tlds: { allow: new Set(['com']) } }
                ],
                ['"\r', false],
                ['"test"@iana.org', false],
                ['""@iana.org', false],
                ['"""@iana.org', false],
                ['"\\a"@iana.org', false],
                ['"\\""@iana.org', false],
                ['"\\"@iana.org', false],
                ['"\\\\"@iana.org', false],
                ['test"@iana.org', false],
                ['"test@iana.org', false],
                ['"test"test@iana.org', false],
                ['test"text"@iana.org', false],
                ['"test""test"@iana.org', false],
                ['"test"."test"@iana.org', false],
                ['"test\\ test"@iana.org', false],
                ['"test".test@iana.org', false],
                ['"test\u0000"@iana.org', false],
                ['"test\\\u0000"@iana.org', false],
                ['"test\r\n test"@iana.org', false],
                ['"abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz abcdefghj"@iana.org', false],
                ['"abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz abcdefg\\h"@iana.org', false],
                ['test@[255.255.255.255]', false],
                ['test@a[255.255.255.255]', false],
                ['test@[255.255.255]', false],
                ['test@[255.255.255.255.255]', false],
                ['test@[255.255.255.256]', false],
                ['test@[1111:2222:3333:4444:5555:6666:7777:8888]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666:7777]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666:7777:8888]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666:7777:8888:9999]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666:7777:888G]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666::8888]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555::8888]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666::7777:8888]', false],
                ['test@[IPv6::3333:4444:5555:6666:7777:8888]', false],
                ['test@[IPv6:::3333:4444:5555:6666:7777:8888]', false],
                ['test@[IPv6:1111::4444:5555::8888]', false],
                ['test@[IPv6:::]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:255.255.255.255]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666:255.255.255.255]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666:7777:255.255.255.255]', false],
                ['test@[IPv6:1111:2222:3333:4444::255.255.255.255]', false],
                ['test@[IPv6:1111:2222:3333:4444:5555:6666::255.255.255.255]', false],
                ['test@[IPv6:1111:2222:3333:4444:::255.255.255.255]', false],
                ['test@[IPv6::255.255.255.255]', false],
                ['test@[255.255.255.255].local', false],
                ['test@local.[255.255.255.255]', false],
                ['test@local.[255.255.255.255].local', false],
                ['test@local.(comment)[255.255.255.255].local', false],
                ['test@local. [255.255.255.255].local', false],
                ['test@local.[255.255.255.255](comment).local', false],
                ['test@local.[255.255.255.255] .local', false],
                [' test @iana.org', false],
                ['test@ iana .com', false],
                ['test . test@iana.org', false],
                ['\r\n test@iana.org', false],
                ['\r\n \r\n test@iana.org', false],
                ['(\r', false],
                ['(comment)test@iana.org', false],
                ['((comment)test@iana.org', false],
                ['(comment(comment))test@iana.org', false],
                ['test@(comment)iana.org', false],
                ['test(comment)@iana.org', false],
                ['test(comment)test@iana.org', false],
                ['test@(comment)[255.255.255.255]', false],
                ['(comment)abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghiklm@iana.org', false],
                ['test@(comment)abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.com', false],
                [
                    '(comment)test@abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefg.abcdefghijklmnopqrstuvwxyzabcdefghijk.abcdefghijklmnopqrst',
                    false
                ],
                ['test@iana.org\n', false],
                ['xn--test@iana.org', true],
                ['test@iana.org-', false],
                ['"test@iana.org', false],
                ['(test@iana.org', false],
                ['test@(iana.org', false],
                ['test@[1.2.3.4', false],
                ['"test\\"@iana.org', false],
                ['(comment\\)test@iana.org', false],
                ['test@iana.org(comment\\)', false],
                ['test@iana.org(comment\\', false],
                ['test@[RFC-5322-domain-literal]', false],
                ['test@[RFC-5322-郵件ñó-domain-literal]', false],
                ['test@[RFC-5322]-domain-literal]', false],
                ['test@[RFC-5322].domain-literal]', false],
                ['test@[RFC-5322-[domain-literal]', false],
                ['test@[', false],
                ['test@[\u0007]', false],
                ['test@[RFC-5322-\\\u0007-domain-literal]', false],
                ['test@[RFC-5322-\\\t-domain-literal]', false],
                ['test@[RFC-5322-\\]-domain-literal]', false],
                ['test@[RFC-5322-\\郵-no-domain-literal]', false],
                ['test@[RFC-5322--domain-literal]', false],
                ['test@[RFC-5322-domain-literal\\]', false],
                ['test@[RFC-5322-domain-literal\\', false],
                ['test@[RFC 5322 domain literal]', false],
                ['test@[RFC-5322-domain-literal] (comment)', false],
                ['@iana.org', false],
                ['test@.org', false],
                ['""@iana.org', false],
                ['""@iana.org', false],
                ['"\\"@iana.org', false],
                ['()test@iana.org', false],
                ['()test@iana.org', false],
                ['test@iana.org\r', false],
                ['\rtest@iana.org', false],
                ['"\rtest"@iana.org', false],
                ['(\r)test@iana.org', false],
                ['test@iana.org(\r)', false],
                ['test@<iana>.org', false],
                ['\ntest@iana.org', false],
                ['"\n"@iana.org', false],
                ['"\\\n"@iana.org', false],
                ['(\n)test@iana.org', false],
                ['\u0007@iana.org', false],
                ['test@\u0007.org', false],
                ['"\u0007"@iana.org', false],
                ['"\\\u0007"@iana.org', false],
                ['(\u0007)test@iana.org', false],
                ['\r\ntest@iana.org', false],
                ['\r\n \r\ntest@iana.org', false],
                [' \r\ntest@iana.org', false],
                [' \r\n test@iana.org', false],
                [' \r\n \r\ntest@iana.org', false],
                [' \r\n\r\ntest@iana.org', false],
                [' \r\n\r\n test@iana.org', false],
                ['test@iana.org\r\n ', false],
                ['test@iana.org\r\n \r\n ', false],
                ['test@iana.org\r\n', false],
                ['test@iana.org \r', false],
                ['test@iana.org\r\n \r\n', false],
                ['test@iana.org \r\n', false],
                ['test@iana.org \r\n ', false],
                ['test@iana.org \r\n \r\n', false],
                ['test@iana.org \r\n\r\n', false],
                ['test@iana.org \r\n\r\n ', false],
                ['test@iana. org', false],
                ['test@[\r', false],
                ['test@[\r\n', false],
                [' test@iana.org', false],
                ['test@iana.org ', false],
                ['test@[IPv6:1::2:]', false],
                ['"test\\\u0094"@iana.org', false],
                ['test@iana/icann.org', false],
                ['test@iana!icann.org', false],
                ['test@iana?icann.org', false],
                ['test@iana^icann.org', false],
                ['test@iana{icann}.org', false],
                ['test.(comment)test@iana.org', false],
                ['test@iana.(comment)org', false],
                ['test@iana(comment)iana.org', false],
                ['(comment\r\n comment)test@iana.org', false],
                ['test@org', true, { minDomainSegments: 1 }],
                ['test\ud800@invalid', false],
                ['"\ud800"@invalid', false],
                ['"\\\ud800"@invalid', false],
                ['(\ud800)thing@invalid', false],
                ['"\\\ud800"@invalid', false],
                [
                    'test@\ud800\udfffñoñó郵件ñoñó郵件.郵件ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.noñó郵件ñoñó郵.商務',
                    false,
                    { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }
                ],
                [
                    'test@\ud800\udfffñoñó郵件ñoñó郵件.郵件ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.ñoñó郵件ñoñó郵件.oñó郵件ñoñó郵件ñoñó郵件.商務',
                    false,
                    { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }
                ],
                [
                    'test@ñoñoñó郵件\ud83d\ude06ñoñ.oñó郵件\uc138ñoñ.oñó郵件\u0644\u4eec\u010dñoñoñó郵件\u05dcño.ñoñó郵件\u092f\u672cñoñoñó郵件\uc138añoñ.oñó郵件\ud83d\ude06bc\uc138郵\ud83d\ude06ño.ñoñó郵件ñoñoñó郵件\ud83d\ude06ñoñoñó郵件\uc138ñoñ.oñó郵件\u0644\u4eecñoñoñó.郵件\ud83d\ude06ñoñoñó郵件郵\uc138ñoñoñó郵件\u0644\u4eecñoñoñó郵件.\ud83d\ude06ñoñoñó郵件郵\uc138\u0644\u4eec.郵件\ud83d\ude06ñoñoñó郵.件郵\uc138\u4eec\ud83d\ude06ñoñoñó件郵\uc138ñoñoñó郵件',
                    false,
                    { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }
                ],
                [
                    'test@ñoñó郵件ñoñó郵件ñoñó郵件ñoñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件ñoñó郵件.商務',
                    false,
                    { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }
                ],
                [
                    '\ud83d\ude06ñoñó郵件ñoñó郵件ñoñó\ud83d\ude06郵件ñoñoñó郵@\ud83d\ude06郵件ñoñó郵件ñoñó.\ud83d\ude06郵件ñoñó郵件ñoñó.\ud83d\ude06郵件ñoñó郵件ñoñó.郵件ñoñó郵件ñoñó\ud83d\ude06.郵件ñoñó郵件ñoñó.郵件ñoñó郵件.ñoñó郵件ñoñó.郵件ñoñó郵件.\ud83d\ude06郵件ñoñó郵件ñoñó.\ud83d\ude06郵件ñoñó郵件ñoñó.\ud83d\ude06商務.郵件ñoñó郵件ñoñó郵件.\ud83d\ude06商務.\ud83d\ude06商務.\ud83d\ude06商務',
                    false,
                    { tlds: { allow: new Set([Punycode.toASCII('商務')]) } }
                ],
                ['test@[\0', false],
                ['(\0)test@example.com', false],
                ['shouldbe@invalid', false],
                ['shouldbe@INVALID', false],
                ['shouldbe@example.com', true],
                ['shouldbe@example.COM', true],
                ['apple-touch-icon-60x60@2x.png', false, { tlds: { allow: new Set(['com']) } }],
                ['shouldbe@XN--UNUP4Y', true, { minDomainSegments: 1 }],
                ['shouldbe@xn--unup4y', true, { minDomainSegments: 1 }],
                ['shouldbe@\u6e38\u620f', true, { minDomainSegments: 1 }],
                ['æøå', false],
                [
                    '1234567890abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvw@xyz.com',
                    true,
                    { ignoreLength: true }
                ],
                ['test@example.com@example.com', false],
                ['test@example.com/path', false],
                ['test@example.com:123', false],
                ['test@example.com_', false],
                ['test@example.com\\', false],
                ['test@example.com\\\\', false],
                ['test@example.com#', false],
                ['test@example.com##', false]
            ]

            for (const [email, result, options] of tests) {
                const valid = isEmailValid(email, options)

                if (valid !== result) {
                    const outcome = analyzeEmail(email, options)
                    if (outcome) {
                        console.log(email, outcome.error)
                    } else {
                        console.log(email)
                    }
                }

                expect(valid).to.equal(result)
            }
        })
    })
})
