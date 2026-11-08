# Third-party notices

Parts of `@lakutata/ldap-engine` are derived from the third-party works listed below; the original
copyright notices and license terms are reproduced here as required. Everything else in the package is written for it.

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

## IETF RFCs (the bundled schema)

The definitions of `src/lib/schema/bundled/` (system, core, cosine, inetorgperson) are taken from the RFCs named in the
comment above each definition, by `scripts/schema/generate.mjs`; a few are amended as their comments say (names the
RFCs register with IANA for the same OID, a syntax RFC 2798 leaves out).

RFC 4512, RFC 4519, RFC 4523, RFC 4524 and RFC 4530: Copyright (C) The Internet Society (2006). RFC 5020: Copyright (C)
The IETF Trust (2007). These documents are subject to the rights, licenses and restrictions contained in BCP 78; the
schema definitions are code fragments of them, which BCP 78 (RFC 3978, section 3.3 (E)) allows to be extracted,
modified and incorporated into other works for any purpose.

RFC 3045: Copyright (C) The Internet Society (2001). RFC 3296: Copyright (C) The Internet Society (2002). RFC 3672:
Copyright (C) The Internet Society (2003). RFC 2798: Copyright (C) The Internet Society (2000). All Rights Reserved.

    This document and translations of it may be copied and furnished to
    others, and derivative works that comment on or otherwise explain it
    or assist in its implementation may be prepared, copied, published
    and distributed, in whole or in part, without restriction of any
    kind, provided that the above copyright notice and this paragraph are
    included on all such copies and derivative works.  However, this
    document itself may not be modified in any way, such as by removing
    the copyright notice or references to the Internet Society or other
    Internet organizations, except as needed for the purpose of
    developing Internet standards in which case the procedures for
    copyrights defined in the Internet Standards process must be
    followed, or as required to translate it into languages other than
    English.

    The limited permissions granted above are perpetual and will not be
    revoked by the Internet Society or its successors or assigns.

RFC 2079 (January 1997, "Distribution of this memo is unlimited") describes labeledURI and labeledURIObject in tables;
the engine writes the same definitions in the form of RFC 4512.

The RFCs: https://www.rfc-editor.org/rfc/rfc4512, rfc4519, rfc4523, rfc4524, rfc4530, rfc5020, rfc3045, rfc3296,
rfc3672, rfc2798, rfc2079.

## bcrypt.js (bcryptjs) 3.0.3

Used in `src/lib/server/bcrypt` (a copy of the module of `@lakutata/security`; see its `UPSTREAM.md`).

Copyright (c) 2012 Nevins Bartolomeo <nevins.bartolomeo@gmail.com>
Copyright (c) 2012 Shane Girish <shaneGirish@gmail.com>
Copyright (c) 2025 Daniel Wirtz <dcode@dcode.io>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
