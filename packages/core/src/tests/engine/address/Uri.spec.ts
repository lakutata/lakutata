/**
 * Ported from address/test/uri.ts (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'

import { uriRegex } from '../../../lib/validation/engine/address/index.js'


// Tests adapted from:
// - https://github.com/joyent/node/blob/cfcb1de130867197cbc9c6012b7e84e08e53d032/test/simple/test-url.js
// - RFC 8936: http://tools.ietf.org/html/rfc3986#page-7

describe('uri', () => {
    const validate = (options, tests) => {
        const { regex } = uriRegex(options)

        for (let i = 0; i < tests.length; ++i) {
            const test = tests[i]
            const [uri, pass] = test
            const match = regex.test(uri)

            if (match !== pass) {
                console.log(i, uri)
            }

            expect(match).to.equal(pass)
        }
    }

    it('validates uri', () => {
        validate({}, [
            ['foo://example.com:8042/over/there?name=ferret#nose', true],
            ['https://example.com?abc[]=123&abc[]=456', false],
            ['urn:example:animal:ferret:nose', true],
            ['ftp://ftp.is.co.za/rfc/rfc1808.txt', true],
            ['http://www.ietf.org/rfc/rfc2396.txt', true],
            ['ldap://[2001:db8::7]/c=GB?objectClass?one', true],
            ['ldap://2001:db8::7/c=GB?objectClass?one', false],
            ['mailto:John.Doe@example.com', true],
            ['news:comp.infosystems.www.servers.unix', true],
            ['tel:+1-816-555-1212', true],
            ['telnet://192.0.2.16:80/', true],
            ['urn:oasis:names:specification:docbook:dtd:xml:4.1.2', true],
            ['file:///example.txt', true],
            ['http://asdf:qw%20er@localhost:8000?asdf=12345&asda=fc%2F#bacon', true],
            ['http://asdf@localhost:8000', true],
            ["http://[v1.09azAZ-._~!$&'()*+,;=:]", true],
            ['http://[a:b:c:d:e::1.2.3.4]', true],
            ['coap://[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]', true],
            ['http://[1080:0:0:0:8:800:200C:417A]', true],
            ["http://v1.09azAZ-._~!$&'()*+,;=:", true], // The `v1.09azAZ-._~!$&\'()*+,;=` part is a valid registered name as it has no invalid characters
            ['http://a:b:c:d:e::1.2.3.4', false],
            ['coap://FEDC:BA98:7654:3210:FEDC:BA98:7654:3210', false],
            ['http://1080:0:0:0:8:800:200C:417A', false],
            ['http://127.0.0.1:8000/foo?bar', true],
            ['http://asdf:qwer@localhost:8000', true],
            ['http://user:pass%3A@localhost:80', true],
            ['http://localhost:123', true],
            ['https://localhost:123', true],
            ['file:///whatever', true],
            ['mailto:asdf@asdf.com', true],
            ['ftp://www.example.com', true],
            ["javascript:alert('hello');", true],
            ['xmpp:isaacschlueter@jabber.org', true],
            ['f://some.host/path', true],
            ['http://localhost:18/asdf', true],
            ['http://localhost:42/asdf?qwer=zxcv', true],
            ['HTTP://www.example.com/', true],
            ['HTTP://www.example.com', true],
            ['http://www.ExAmPlE.com/', true],
            ['http://user:pw@www.ExAmPlE.com/', true],
            ['http://USER:PW@www.ExAmPlE.com/', true],
            ['http://user@www.example.com/', true],
            ['http://user%3Apw@www.example.com/', true],
            ['http://x.com/path?that%27s#all,%20folks', true],
            ['HTTP://X.COM/Y', true],
            ['http://www.narwhaljs.org/blog/categories?id=news', true],
            ['http://mt0.google.com/vt/lyrs=m@114&hl=en&src=api&x=2&y=2&z=3&s=', true],
            ['http://mt0.google.com/vt/lyrs=m@114???&hl=en&src=api&x=2&y=2&z=3&s=', true],
            ['http://user:pass@mt0.google.com/vt/lyrs=m@114???&hl=en&src=api&x=2&y=2&z=3&s=', true],
            ['http://_jabber._tcp.google.com:80/test', true],
            ['http://user:pass@_jabber._tcp.google.com:80/test', true],
            ['http://[fe80::1]/a/b?a=b#abc', true],
            ['http://fe80::1/a/b?a=b#abc', false],
            ['http://user:password@[3ffe:2a00:100:7031::1]:8080', true],
            ['coap://[1080:0:0:0:8:800:200C:417A]:61616/', true],
            ['coap://1080:0:0:0:8:800:200C:417A:61616/', false],
            ['git+http://github.com/joyent/node.git', true],
            ['http://bucket_name.s3.amazonaws.com/image.jpg', true],
            ['dot.test://foo/bar', true],
            ['svn+ssh://foo/bar', true],
            ['dash-test://foo/bar', true],
            ['xmpp:isaacschlueter@jabber.org', true],
            ['http://atpass:foo%40bar@127.0.0.1:8080/path?search=foo#bar', true],
            ["javascript:alert('hello');", true],
            ['file://localhost/etc/node/', true],
            ['file:///etc/node/', true],
            ['http://USER:PW@www.ExAmPlE.com/', true],
            ['mailto:local1@domain1?query1', true],
            ['http://example/a/b?c/../d', true],
            ['http://example/x%2Fabc', true],
            ['http://a/b/c/d;p=1/g;x=1/y', true],
            ['http://a/b/c/g#s/../x', true],
            ['http://a/b/c/.foo', true],
            ['http://example.com/b//c//d;p?q#blarg', true],
            ['g:h', true],
            ['http://a/b/c/g', true],
            ['http://a/b/c/g/', true],
            ['http://a/g', true],
            ['http://g', true],
            ['http://a/b/c/d;p?y', true],
            ['http://a/b/c/g?y', true],
            ['http://a/b/c/d;p?q#s', true],
            ['http://a/b/c/g#s', true],
            ['http://a/b/c/g?y#s', true],
            ['http://a/b/c/;x', true],
            ['http://a/b/c/g;x', true],
            ['http://a/b/c/g;x?y#s', true],
            ['http://a/b/c/d;p?q', true],
            ['http://a/b/c/', true],
            ['http://a/b/', true],
            ['http://a/b/g', true],
            ['http://a/', true],
            ['http://a/g', true],
            ['http://a/g', true],
            ['http:///a/g', false],
            ['file:/asda', true],
            ['qwerty', false],
            ['invalid uri', false],
            ['1http://google.com', false],
            ['http://testdomain`,.<>/?\'";{}][++\\|~!@#$%^&*().org', false],
            ['', false],
            ['(╯°□°)╯︵ ┻━┻', false],
            ['one/two/three?value=abc&value2=123#david-rules', false],
            ['//username:password@test.example.com/one/two/three?value=abc&value2=123#david-rules', false],
            ['http://a\r" \t\n<\'b:b@c\r\nd/e?f', false],
            ['/absolute', false],
            ['http:/example.com', false],
            ['http:example.com', false]
        ])
    })

    it('validates uri with a single scheme provided', () => {
        validate({ scheme: 'http' }, [
            ['http://google.com', true],
            ['https://google.com', false],
            ['ftp://google.com', false],
            ['file:/asdf', false],
            ['/path?query=value#hash', false]
        ])
    })

    it('validates uri with a single regex scheme provided', () => {
        validate({ scheme: /https?/ }, [
            ['http://google.com', true],
            ['https://google.com', true],
            ['ftp://google.com', false],
            ['file:/asdf', false],
            ['/path?query=value#hash', false]
        ])
    })

    it('validates uri with multiple schemes provided', () => {
        validate({ scheme: [/https?/, 'ftp', 'file', 'git+http'] }, [
            ['http://google.com', true],
            ['https://google.com', true],
            ['ftp://google.com', true],
            ['file:/asdf', true],
            ['git+http://github.com/hapijs/hoek', true],
            ['/path?query=value#hash', false]
        ])
    })

    it('validates relative uri', () => {
        validate({ allowRelative: true }, [
            ['foo://example.com:8042/over/there?name=ferret#nose', true],
            ['urn:example:animal:ferret:nose', true],
            ['ftp://ftp.is.co.za/rfc/rfc1808.txt', true],
            ['http://www.ietf.org/rfc/rfc2396.txt', true],
            ['ldap://[2001:db8::7]/c=GB?objectClass?one', true],
            ['mailto:John.Doe@example.com', true],
            ['news:comp.infosystems.www.servers.unix', true],
            ['tel:+1-816-555-1212', true],
            ['telnet://192.0.2.16:80/', true],
            ['urn:oasis:names:specification:docbook:dtd:xml:4.1.2', true],
            ['file:///example.txt', true],
            ['http://asdf:qw%20er@localhost:8000?asdf=12345&asda=fc%2F#bacon', true],
            ['http://asdf@localhost:8000', true],
            ["http://[v1.09azAZ-._~!$&'()*+,;=:]", true],
            ['http://[a:b:c:d:e::1.2.3.4]', true],
            ['coap://[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]', true],
            ['http://[1080:0:0:0:8:800:200C:417A]', true],
            ['http://127.0.0.1:8000/foo?bar', true],
            ['http://asdf:qwer@localhost:8000', true],
            ['http://user:pass%3A@localhost:80', true],
            ['http://localhost:123', true],
            ['https://localhost:123', true],
            ['file:///whatever', true],
            ['mailto:asdf@asdf.com', true],
            ['ftp://www.example.com', true],
            ["javascript:alert('hello');", true],
            ['xmpp:isaacschlueter@jabber.org', true],
            ['f://some.host/path', true],
            ['http://localhost:18/asdf', true],
            ['http://localhost:42/asdf?qwer=zxcv', true],
            ['HTTP://www.example.com/', true],
            ['HTTP://www.example.com', true],
            ['http://www.ExAmPlE.com/', true],
            ['http://user:pw@www.ExAmPlE.com/', true],
            ['http://USER:PW@www.ExAmPlE.com/', true],
            ['http://user@www.example.com/', true],
            ['http://user%3Apw@www.example.com/', true],
            ['http://x.com/path?that%27s#all,%20folks', true],
            ['HTTP://X.COM/Y', true],
            ['http://www.narwhaljs.org/blog/categories?id=news', true],
            ['http://mt0.google.com/vt/lyrs=m@114&hl=en&src=api&x=2&y=2&z=3&s=', true],
            ['http://mt0.google.com/vt/lyrs=m@114???&hl=en&src=api&x=2&y=2&z=3&s=', true],
            ['http://user:pass@mt0.google.com/vt/lyrs=m@114???&hl=en&src=api&x=2&y=2&z=3&s=', true],
            ['http://_jabber._tcp.google.com:80/test', true],
            ['http://user:pass@_jabber._tcp.google.com:80/test', true],
            ['http://[fe80::1]/a/b?a=b#abc', true],
            ['http://user:password@[3ffe:2a00:100:7031::1]:8080', true],
            ['coap://[1080:0:0:0:8:800:200C:417A]:61616/', true],
            ['git+http://github.com/joyent/node.git', true],
            ['http://bucket_name.s3.amazonaws.com/image.jpg', true],
            ['dot.test://foo/bar', true],
            ['svn+ssh://foo/bar', true],
            ['dash-test://foo/bar', true],
            ['xmpp:isaacschlueter@jabber.org', true],
            ['http://atpass:foo%40bar@127.0.0.1:8080/path?search=foo#bar', true],
            ["javascript:alert('hello');", true],
            ['file://localhost/etc/node/', true],
            ['file:///etc/node/', true],
            ['http://USER:PW@www.ExAmPlE.com/', true],
            ['mailto:local1@domain1?query1', true],
            ['http://example/a/b?c/../d', true],
            ['http://example/x%2Fabc', true],
            ['http://a/b/c/d;p=1/g;x=1/y', true],
            ['http://a/b/c/g#s/../x', true],
            ['http://a/b/c/.foo', true],
            ['http://example.com/b//c//d;p?q#blarg', true],
            ['g:h', true],
            ['http://a/b/c/g', true],
            ['http://a/b/c/g/', true],
            ['http://a/g', true],
            ['http://g', true],
            ['http://a/b/c/d;p?y', true],
            ['http://a/b/c/g?y', true],
            ['http://a/b/c/d;p?q#s', true],
            ['http://a/b/c/g#s', true],
            ['http://a/b/c/g?y#s', true],
            ['http://a/b/c/;x', true],
            ['http://a/b/c/g;x', true],
            ['http://a/b/c/g;x?y#s', true],
            ['http://a/b/c/d;p?q', true],
            ['http://a/b/c/', true],
            ['http://a/b/', true],
            ['http://a/b/g', true],
            ['http://a/', true],
            ['http://a/g', true],
            ['http://a/g', true],
            ['file:/asda', true],
            ['qwerty', true],
            ['invalid uri', false],
            ['1http://google.com', false],
            ['http://testdomain`,.<>/?\'";{}][++\\|~!@#$%^&*().org', false],
            ['', false],
            ['(╯°□°)╯︵ ┻━┻', false],
            ['one/two/three?value=abc&value2=123#david-rules', true],
            ['//username:password@test.example.com/one/two/three?value=abc&value2=123#david-rules', true],
            ['http://a\r" \t\n<\'b:b@c\r\nd/e?f', false],
            ['/absolute', true],
            ['http://', false],
            ['http:/', false],
            ['https:/', false]
        ])
    })

    it('validates relative only uri', () => {
        validate({ relativeOnly: true }, [
            ['foo://example.com:8042/over/there?name=ferret#nose', false],
            ['urn:example:animal:ferret:nose', false],
            ['ftp://ftp.is.co.za/rfc/rfc1808.txt', false],
            ['http://www.ietf.org/rfc/rfc2396.txt', false],
            ['ldap://[2001:db8::7]/c=GB?objectClass?one', false],
            ['mailto:John.Doe@example.com', false],
            ['news:comp.infosystems.www.servers.unix', false],
            ['tel:+1-816-555-1212', false],
            ['telnet://192.0.2.16:80/', false],
            ['urn:oasis:names:specification:docbook:dtd:xml:4.1.2', false],
            ['file:///example.txt', false],
            ['http://asdf:qw%20er@localhost:8000?asdf=12345&asda=fc%2F#bacon', false],
            ['http://asdf@localhost:8000', false],
            ["http://[v1.09azAZ-._~!$&'()*+,;=:]", false],
            ['http://[a:b:c:d:e::1.2.3.4]', false],
            ['coap://[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]', false],
            ['http://[1080:0:0:0:8:800:200C:417A]', false],
            ['http://127.0.0.1:8000/foo?bar', false],
            ['http://asdf:qwer@localhost:8000', false],
            ['http://user:pass%3A@localhost:80', false],
            ['http://localhost:123', false],
            ['https://localhost:123', false],
            ['file:///whatever', false],
            ['mailto:asdf@asdf.com', false],
            ['ftp://www.example.com', false],
            ["javascript:alert('hello');", false],
            ['xmpp:isaacschlueter@jabber.org', false],
            ['f://some.host/path', false],
            ['http://localhost:18/asdf', false],
            ['http://localhost:42/asdf?qwer=zxcv', false],
            ['HTTP://www.example.com/', false],
            ['HTTP://www.example.com', false],
            ['http://www.ExAmPlE.com/', false],
            ['http://user:pw@www.ExAmPlE.com/', false],
            ['http://USER:PW@www.ExAmPlE.com/', false],
            ['http://user@www.example.com/', false],
            ['http://user%3Apw@www.example.com/', false],
            ['http://x.com/path?that%27s#all,%20folks', false],
            ['HTTP://X.COM/Y', false],
            ['http://www.narwhaljs.org/blog/categories?id=news', false],
            ['http://mt0.google.com/vt/lyrs=m@114&hl=en&src=api&x=2&y=2&z=3&s=', false],
            ['http://mt0.google.com/vt/lyrs=m@114???&hl=en&src=api&x=2&y=2&z=3&s=', false],
            ['http://user:pass@mt0.google.com/vt/lyrs=m@114???&hl=en&src=api&x=2&y=2&z=3&s=', false],
            ['http://_jabber._tcp.google.com:80/test', false],
            ['http://user:pass@_jabber._tcp.google.com:80/test', false],
            ['http://[fe80::1]/a/b?a=b#abc', false],
            ['http://user:password@[3ffe:2a00:100:7031::1]:8080', false],
            ['coap://[1080:0:0:0:8:800:200C:417A]:61616/', false],
            ['git+http://github.com/joyent/node.git', false],
            ['http://bucket_name.s3.amazonaws.com/image.jpg', false],
            ['dot.test://foo/bar', false],
            ['svn+ssh://foo/bar', false],
            ['dash-test://foo/bar', false],
            ['xmpp:isaacschlueter@jabber.org', false],
            ['http://atpass:foo%40bar@127.0.0.1:8080/path?search=foo#bar', false],
            ["javascript:alert('hello');", false],
            ['file://localhost/etc/node/', false],
            ['file:///etc/node/', false],
            ['http://USER:PW@www.ExAmPlE.com/', false],
            ['mailto:local1@domain1?query1', false],
            ['http://example/a/b?c/../d', false],
            ['http://example/x%2Fabc', false],
            ['http://a/b/c/d;p=1/g;x=1/y', false],
            ['http://a/b/c/g#s/../x', false],
            ['http://a/b/c/.foo', false],
            ['http://example.com/b//c//d;p?q#blarg', false],
            ['g:h', false],
            ['http://a/b/c/g', false],
            ['http://a/b/c/g/', false],
            ['http://a/g', false],
            ['http://g', false],
            ['http://a/b/c/d;p?y', false],
            ['http://a/b/c/g?y', false],
            ['http://a/b/c/d;p?q#s', false],
            ['http://a/b/c/g#s', false],
            ['http://a/b/c/g?y#s', false],
            ['http://a/b/c/;x', false],
            ['http://a/b/c/g;x', false],
            ['http://a/b/c/g;x?y#s', false],
            ['http://a/b/c/d;p?q', false],
            ['http://a/b/c/', false],
            ['http://a/b/', false],
            ['http://a/b/g', false],
            ['http://a/', false],
            ['http://a/g', false],
            ['http://a/g', false],
            ['file:/asda', false],
            ['qwerty', true],
            ['invalid uri', false],
            ['1http://google.com', false],
            ['http://testdomain`,.<>/?\'";{}][++\\|~!@#$%^&*().org', false],
            ['', false],
            ['(╯°□°)╯︵ ┻━┻', false],
            ['one/two/three?value=abc&value2=123#david-rules', true],
            ['//username:password@test.example.com/one/two/three?value=abc&value2=123#david-rules', true],
            ['http://a\r" \t\n<\'b:b@c\r\nd/e?f', false],
            ['/absolute', true]
        ])
    })

    it('validates uri with square brackets allowed', () => {
        validate({ allowQuerySquareBrackets: true }, [['https://example.com?abc[]=123&abc[]=456', true]])
    })

    it('captures domain', () => {
        expect(uriRegex({ domain: true }).raw).to.contain('@)?((?:')
    })
})
