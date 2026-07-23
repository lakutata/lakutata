// Consumer type-check fixture (G3-01).
// Proves every published subpath's GENERATED .d.ts resolves under tsc, run
// against the built distro/ (not src/). Catches: a .d.ts pointing at a moved
// internal path, a missing vendor TypeDef chunk, a dropped/retyped export, or
// an external typeorm resolution failure. Run via: npm run test:types
//
// The `import type * as ns` + `typeof ns` form proves each subpath resolves and
// is non-empty without guessing whether each symbol is a type or a value. The
// named pins below additionally guard the most-used public symbols from being
// dropped or retyped.
import type * as root from 'lakutata'
import type * as orm from 'lakutata/orm'
import type * as dtos from 'lakutata/dtos'
import type * as helper from 'lakutata/helper'
import type * as docker from 'lakutata/com/docker'
import type * as database from 'lakutata/com/database'
import type * as cacher from 'lakutata/com/cacher'
import type * as monitor from 'lakutata/com/monitor'
import type * as entrypoint from 'lakutata/com/entrypoint'
import type * as logger from 'lakutata/com/logger'
import type * as providerDatabase from 'lakutata/provider/database'
import type * as passwordHash from 'lakutata/provider/passwordHash'
import type * as asst from 'lakutata/decorator/asst'
import type * as ctrl from 'lakutata/decorator/ctrl'
import type * as di from 'lakutata/decorator/di'
import type * as dtoDec from 'lakutata/decorator/dto'
import type * as ormDec from 'lakutata/decorator/orm'

// Breadth: every one of the 17 code subpaths must resolve to a non-empty namespace.
export type _root = typeof root
export type _orm = typeof orm
export type _dtos = typeof dtos
export type _helper = typeof helper
export type _docker = typeof docker
export type _database = typeof database
export type _cacher = typeof cacher
export type _monitor = typeof monitor
export type _entrypoint = typeof entrypoint
export type _logger = typeof logger
export type _providerDatabase = typeof providerDatabase
export type _passwordHash = typeof passwordHash
export type _asst = typeof asst
export type _ctrl = typeof ctrl
export type _di = typeof di
export type _dtoDec = typeof dtoDec
export type _ormDec = typeof ormDec

// Depth: pin the most-used public symbols so a dropped/retyped export is caught.
import type {Application, BaseObject, DTO} from 'lakutata'
import type {Inject} from 'lakutata/decorator/di'
import type {Expect} from 'lakutata/decorator/dto'
import type {Entity} from 'lakutata/decorator/orm'
import type {PaginationSearchDTO} from 'lakutata/dtos'
export type _Application = Application
export type _BaseObject = BaseObject
export type _DTO = DTO
export type _Inject = typeof Inject
export type _Expect = typeof Expect
export type _Entity = typeof Entity
export type _PaginationSearchDTO = PaginationSearchDTO


