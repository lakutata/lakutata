# bcrypt: upstream provenance

`index.ts` and `constants.ts` are copied unchanged from `@lakutata/security` (`src/lib/bcrypt/`), whose module is derived
from [dcodeIO/bcrypt.js](https://github.com/dcodeIO/bcrypt.js) (npm: bcryptjs) 3.0.3, commit
1211e9a2213e0b3ee232a204b3ce899beebce31a, `index.js`; its differences from upstream are listed in that package's
`src/lib/bcrypt/UPSTREAM.md`. The engine has no dependencies, so it keeps a copy; it uses `compare()` to check the
`{CRYPT}$2a$`, `$2b$` and `$2y$` passwords. License text: `THIRD_PARTY_NOTICES.md` in the package root.
