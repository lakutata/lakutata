# Third-party notices

Parts of the tests of `@lakutata/ldap-engine` are derived from the third-party projects listed below; the original
copyright notices and license terms are reproduced here as required. The code of the package itself is written for it.

## ldapjs

The messages of `src/tests/support/LdapjsFixtures.ts` are the byte fixtures of `@ldapjs/messages` 1.3.0
(`lib/messages/_fixtures/message-byte-arrays.js`, most of them taken by ldapjs from the LDAPv3 wire protocol reference
of Neil Wilson) and the filter fixture of `@ldapjs/filter` 2.1.1 (`lib/ber-parsing/_fixtures/evolution-filter.js`);
the cases of `src/tests/LdapjsDN.spec.ts` are those of `@ldapjs/dn` 1.1.0 (`lib/utils/parse-string/index.test.js`).
ldapjs: https://github.com/ldapjs/node-ldapjs

```
Copyright (c) 2014 Patrick Mooney. All rights reserved.
Copyright (c) 2014 Mark Cavage, Inc. All rights reserved.
Copyright (c) 2022 The LDAPJS Collaborators.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE
```
