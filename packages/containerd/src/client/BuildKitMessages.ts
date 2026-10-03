import type {Schema} from './Protobuf.js'
import {Timestamp} from './Messages.js'

/*
 * The messages of the API of BuildKit (github.com/moby/buildkit: api/services/control, session/filesync,
 * session/auth) and of fsutil (github.com/tonistiigi/fsutil: types), the fields read and written
 */

export const BytesMessage: Schema = {data: {no: 1, type: 'bytes'}}

export const ExporterMessage: Schema = {
    type: {no: 1, type: 'string'},
    attrs: {no: 2, type: 'string', map: true}
}

export const SolveRequest: Schema = {
    ref: {no: 1, type: 'string'},
    exporter: {no: 3, type: 'string'},
    exporterAttrs: {no: 4, type: 'string', map: true},
    session: {no: 5, type: 'string'},
    frontend: {no: 6, type: 'string'},
    frontendAttrs: {no: 7, type: 'string', map: true},
    entitlements: {no: 9, type: 'string', repeated: true},
    exporters: {no: 13, type: ExporterMessage, repeated: true}
}
export const SolveResponse: Schema = {exporterResponse: {no: 1, type: 'string', map: true}}

export const StatusRequest: Schema = {ref: {no: 1, type: 'string'}}
export const Vertex: Schema = {
    digest: {no: 1, type: 'string'},
    inputs: {no: 2, type: 'string', repeated: true},
    name: {no: 3, type: 'string'},
    cached: {no: 4, type: 'bool'},
    started: {no: 5, type: Timestamp},
    completed: {no: 6, type: Timestamp},
    error: {no: 7, type: 'string'}
}
export const VertexStatus: Schema = {
    id: {no: 1, type: 'string'},
    vertex: {no: 2, type: 'string'},
    name: {no: 3, type: 'string'},
    current: {no: 4, type: 'int64'},
    total: {no: 5, type: 'int64'}
}
export const VertexLog: Schema = {
    vertex: {no: 1, type: 'string'},
    stream: {no: 3, type: 'int64'},
    msg: {no: 4, type: 'bytes'}
}
export const VertexWarning: Schema = {
    vertex: {no: 1, type: 'string'},
    level: {no: 2, type: 'int64'},
    short: {no: 3, type: 'bytes'},
    url: {no: 5, type: 'string'}
}
export const StatusResponse: Schema = {
    vertexes: {no: 1, type: Vertex, repeated: true},
    statuses: {no: 2, type: VertexStatus, repeated: true},
    logs: {no: 3, type: VertexLog, repeated: true},
    warnings: {no: 4, type: VertexWarning, repeated: true}
}

export const BuildkitVersion: Schema = {
    package: {no: 1, type: 'string'},
    version: {no: 2, type: 'string'},
    revision: {no: 3, type: 'string'}
}
export const InfoResponse: Schema = {buildkitVersion: {no: 1, type: BuildkitVersion}}

export const BuildKitPlatform: Schema = {
    architecture: {no: 1, type: 'string'},
    os: {no: 2, type: 'string'},
    variant: {no: 3, type: 'string'}
}
export const WorkerRecord: Schema = {
    id: {no: 1, type: 'string'},
    labels: {no: 2, type: 'string', map: true},
    platforms: {no: 3, type: BuildKitPlatform, repeated: true}
}
export const ListWorkersRequest: Schema = {filter: {no: 1, type: 'string', repeated: true}}
export const ListWorkersResponse: Schema = {record: {no: 1, type: WorkerRecord, repeated: true}}

/*
 * The session: the files (fsutil), the credentials of the registries, its health
 */

/**
 * The types of the packets of fsutil
 */
export enum PacketType {
    STAT = 0,
    REQ = 1,
    DATA = 2,
    FIN = 3,
    ERR = 4
}

export const Stat: Schema = {
    path: {no: 1, type: 'string'},
    mode: {no: 2, type: 'uint32'},
    uid: {no: 3, type: 'uint32'},
    gid: {no: 4, type: 'uint32'},
    size: {no: 5, type: 'int64'},
    modTime: {no: 6, type: 'int64'},
    linkname: {no: 7, type: 'string'},
    devmajor: {no: 8, type: 'int64'},
    devminor: {no: 9, type: 'int64'}
}
export const Packet: Schema = {
    type: {no: 1, type: 'enum'},
    stat: {no: 2, type: Stat},
    id: {no: 3, type: 'uint32'},
    data: {no: 4, type: 'bytes'}
}

export const CredentialsRequest: Schema = {host: {no: 1, type: 'string'}}
export const CredentialsResponse: Schema = {username: {no: 1, type: 'string'}, secret: {no: 2, type: 'string'}}
export const FetchTokenRequest: Schema = {
    clientId: {no: 1, type: 'string'},
    host: {no: 2, type: 'string'},
    realm: {no: 3, type: 'string'},
    service: {no: 4, type: 'string'},
    scopes: {no: 5, type: 'string', repeated: true}
}
export const FetchTokenResponse: Schema = {
    token: {no: 1, type: 'string'},
    expiresIn: {no: 2, type: 'int64'},
    issuedAt: {no: 3, type: 'int64'}
}

export const HealthCheckRequest: Schema = {service: {no: 1, type: 'string'}}
export const HealthCheckResponse: Schema = {status: {no: 1, type: 'enum'}}
