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
/* eslint-disable no-duplicate-imports -- each subpath is imported as a namespace and by its pinned symbols */
import type * as root from 'lakutata'
import type * as orm from 'lakutata/orm'
import type * as dtos from 'lakutata/dtos'
import type * as utils from 'lakutata/utils'
import type * as containerd from 'lakutata/com/containerd'
import type * as docker from 'lakutata/com/docker'
import type * as database from 'lakutata/com/database'
import type * as cacher from 'lakutata/com/cacher'
import type * as monitor from 'lakutata/com/monitor'
import type * as entrypoint from 'lakutata/com/entrypoint'
import type * as logger from 'lakutata/com/logger'
import type * as providerDatabase from 'lakutata/provider/database'
import type * as passwordHash from 'lakutata/provider/passwordHash'
import type * as security from 'lakutata/security'
import type * as asst from 'lakutata/decorator/asst'
import type * as ctrl from 'lakutata/decorator/ctrl'
import type * as di from 'lakutata/decorator/di'
import type * as dtoDec from 'lakutata/decorator/dto'
import type * as ormDec from 'lakutata/decorator/orm'

// Breadth: every one of the 17 code subpaths must resolve to a non-empty namespace.
export type _root = typeof root
export type _orm = typeof orm
export type _dtos = typeof dtos
export type _utils = typeof utils
export type _containerd = typeof containerd
export type _docker = typeof docker
export type _database = typeof database
export type _cacher = typeof cacher
export type _monitor = typeof monitor
export type _entrypoint = typeof entrypoint
export type _logger = typeof logger
export type _providerDatabase = typeof providerDatabase
export type _passwordHash = typeof passwordHash
export type _security = typeof security
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



// The handlers of 2.x declare the Logger component as their logger
import type {Logger} from 'lakutata/com/logger'
export const _launched: Parameters<typeof Application.onLaunched>[0] = (app: Application, logger: Logger): void => logger.info(app.appName)
export const _fatal: Parameters<typeof Application.onFatalException>[0] = (error: Error, logger: Logger): number => (logger.error(error), 1)

// Middlewares of the entrypoint
import type {Middleware, MiddlewareHandler, ActionInvocation} from 'lakutata/com/entrypoint'
import type {UseMiddlewares} from 'lakutata/decorator/ctrl'
export type _Middleware = Middleware
export type _MiddlewareHandler = MiddlewareHandler
export type _ActionInvocation = ActionInvocation
export type _UseMiddlewares = typeof UseMiddlewares

// Controller prefixes
import type {PrefixOptions} from 'lakutata/com/entrypoint'
import type {Prefix} from 'lakutata/decorator/ctrl'
export type _PrefixOptions = PrefixOptions
export type _Prefix = typeof Prefix

// A channel package adds its options to the entrypoint (declaration merging through the re-exports)
import type {EntrypointAdapter, EntrypointOptions} from 'lakutata/com/entrypoint'
declare module '@lakutata/entrypoint' {
    interface EntrypointOptions {
        custom?: EntrypointAdapter | EntrypointAdapter[]
    }

    interface PrefixOptions {
        custom?: string
    }
}
declare const customAdapter: EntrypointAdapter
export const _customOptions: EntrypointOptions = {controllers: [], custom: customAdapter}
export const _customPrefix: Pick<PrefixOptions, 'custom'> = {custom: '/custom'}
// @ts-expect-error an undeclared channel key is rejected
export const _unknownOptions: EntrypointOptions = {controllers: [], unknown: customAdapter}

// The express adapter of the HTTP channel
import type {ExpressHTTPEntrypoint, JSONEnvelope} from 'lakutata/adapter/express'
import type {Result} from 'lakutata/com/entrypoint'
export type _ExpressHTTPEntrypoint = typeof ExpressHTTPEntrypoint
export type _JSONEnvelope = typeof JSONEnvelope
export type _Result = typeof Result
declare const expressEntrypoint: typeof ExpressHTTPEntrypoint
export const _httpOptions: EntrypointOptions = {controllers: [], http: expressEntrypoint({port: 3000})}

// The commander adapter of the CLI channel
import type {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
declare const commanderEntrypoint: typeof CommanderCLIEntrypoint
export const _cliOptions: EntrypointOptions = {controllers: [], cli: commanderEntrypoint({version: '1.0.0', interactive: 'auto'})}

// The schedule channel: built in, enabled with its adapter
import {ScheduleEntrypoint} from 'lakutata/com/entrypoint'
import type {ScheduleContext} from 'lakutata/com/entrypoint'
import type {Schedule, ScheduleOptions} from 'lakutata/decorator/ctrl'
export const _scheduleOptions: EntrypointOptions = {controllers: [], schedule: ScheduleEntrypoint({onSkip: (): void => undefined})}
export const _every: ScheduleOptions = {every: '30s', overlap: false}
export const _cron: ScheduleOptions = {cron: '0 9 * * MON-FRI', timezone: 'Asia/Shanghai', immediate: true}
// @ts-expect-error a schedule is an interval or a cron expression, not both
export const _both: ScheduleOptions = {every: '30s', cron: '* * * * *'}
export type _Schedule = typeof Schedule
export type _ScheduleContext = ScheduleContext['scheduledAt']

// The fastify adapter of the HTTP channel
import type {FastifyHTTPEntrypoint, FastifyJSONEnvelope} from 'lakutata/adapter/fastify'
declare const fastifyEntrypoint: typeof FastifyHTTPEntrypoint
declare const fastifyEnvelope: typeof FastifyJSONEnvelope
export const _fastifyOptions: EntrypointOptions = {controllers: [], http: fastifyEntrypoint({port: 3000, respond: fastifyEnvelope(), before: async (app): Promise<void> => void app.get('/health', async (): Promise<unknown> => ({status: 'ok'}))})}

// The socket.io and Electron adapters of the service channel
import type {SocketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import type {ElectronIPCServiceEntrypoint, IPCMain} from 'lakutata/adapter/electron'
declare const socketIOEntrypoint: typeof SocketIOServiceEntrypoint
declare const electronEntrypoint: typeof ElectronIPCServiceEntrypoint
declare const ipcMain: IPCMain
export const _socketIOOptions: EntrypointOptions = {controllers: [], service: socketIOEntrypoint({port: 3001, options: {cors: {origin: '*'}}})}
export const _electronOptions: EntrypointOptions = {controllers: [], service: [electronEntrypoint({ipcMain: ipcMain}), socketIOEntrypoint()]}

// The JSON-RPC 2.0 adapter of the service channel: HTTP, WebSocket, stdio
import type {JSONRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'
declare const jsonrpcEntrypoint: typeof JSONRPCServiceEntrypoint
export const _jsonrpcOptions: EntrypointOptions = {controllers: [], service: [jsonrpcEntrypoint({port: 4000, path: '/rpc'}), jsonrpcEntrypoint({transport: 'websocket', port: 4001}), jsonrpcEntrypoint({transport: 'stdio', framing: 'content-length', toPattern: (method: string): Record<string, unknown> => ({cmd: method})})]}
