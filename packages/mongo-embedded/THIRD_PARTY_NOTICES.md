# Third-party notices

The addon of `@lakutata/mongo-embedded` is compiled, when the package is installed, from the source of SQLite in
`native/engine` (`engine.c` and `engine.h`, its `sqlite3.c` and `sqlite3.h` renamed) and from part of ICU's source in
`vendor/icu`. Their versions, archives and checksums are in `vendor/UPSTREAM.json`; neither is changed
(`vendor/PATCHES.md`). The queries and the updates run on the source of mingo, in `src/lib/mingo`.

## SQLite 3.53.2

The storage of the databases (https://sqlite.org). SQLite is in the public domain; its source carries this blessing in
place of a license:

```
The author disclaims copyright to this source code.  In place of
a legal notice, here is a blessing:

   May you do good and not evil.
   May you find forgiveness for yourself and forgive others.
   May you share freely, never taking more than you give.
```

## mingo 7.2.4

The query, update and aggregation engine in `src/lib/mingo` is derived from the source of mingo
(https://github.com/kofrasa/mingo, tag `7.2.4`; its archive and checksum are in `vendor/UPSTREAM.json`).

Modifications: the repository's code style; `.js` extensions on import specifiers (the package's modules are ES modules
resolved by Node.js); a type annotation where the package's stricter compiler settings needed one. Values are compared
as MongoDB compares them (`util/_bson.ts`): BSON types in MongoDB's order; numbers of every type (number, bigint, Long,
Int32, Double, Decimal128) by their exact values, in comparisons, equality tests, hashes and group keys; strings by code
point; documents field by field in field order; arrays item by item. The comparison operators match only values of the
same type bracket (null also matches a missing field); `$type` recognizes every BSON type; `$mod` matches numbers only;
a sort orders an array by its smallest item (ascending) or its largest (descending), with empty arrays first. An update
that changes a document's `_id` fails with `ImmutableFieldError` (code 66) and leaves the document unchanged; setting
`_id` to its current value, or setting it on a document that has none, is allowed. A pipeline update whose result omits
`_id` keeps the document's `_id`. Arithmetic follows MongoDB's numeric types (`util/_numeric.ts`): a result takes the
widest type of its operands (int, long, double, decimal); an int that overflows becomes a long, and a long that
overflows a double; a double combined with a decimal is first converted to a decimal of 15 significant digits; decimals
are rounded to 34 significant digits, half to even. `$round` and `$trunc` round a double through its 15-digit decimal,
`$toDecimal` returns a Decimal128, and `$inc` or `$mul` on a non-numeric field fails with `MongoCodeError` (code 14).
Strings are compared, hashed and grouped by the collation the client sets for the running operation (`withCollation`);
the `collation` option is ignored, and `$sort` no longer uses `Intl.Collator`.

```
The MIT License (MIT)

Copyright (c) 2013-2025 Francis Asante

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## ICU 77.1

The collators behind the collations (https://icu.unicode.org): the ICU sources they use, in `vendor/icu/source`, and the
collation data, `vendor/icu/icudt77l.dat`, built from the release's data. ICU is under the Unicode License V3,
reproduced below. The full license file, including the licenses of parts of ICU that come from other projects, is
`vendor/icu/LICENSE`, shipped with the package.

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2016-2025 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
```
