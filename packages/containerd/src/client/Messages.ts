import type {Schema} from './Protobuf.js'

/*
 * The messages of the API of containerd (github.com/containerd/containerd, api/), the fields read and written: their
 * numbers are the ones of its proto files (the version 1 of its services, the ones of containerd 1.6 to 2)
 */

export const Empty: Schema = {}

export const Timestamp: Schema = {
    seconds: {no: 1, type: 'int64'},
    nanos: {no: 2, type: 'int32'}
}

export const Any: Schema = {
    typeUrl: {no: 1, type: 'string'},
    value: {no: 2, type: 'bytes'}
}

export const FieldMask: Schema = {
    paths: {no: 1, type: 'string', repeated: true}
}

export const Descriptor: Schema = {
    mediaType: {no: 1, type: 'string'},
    digest: {no: 2, type: 'string'},
    size: {no: 3, type: 'int64'},
    annotations: {no: 5, type: 'string', map: true}
}

export const Mount: Schema = {
    type: {no: 1, type: 'string'},
    source: {no: 2, type: 'string'},
    target: {no: 3, type: 'string'},
    options: {no: 4, type: 'string', repeated: true}
}

/*
 * Version
 */
export const VersionResponse: Schema = {
    version: {no: 1, type: 'string'},
    revision: {no: 2, type: 'string'}
}

/*
 * Namespaces
 */
export const Namespace: Schema = {
    name: {no: 1, type: 'string'},
    labels: {no: 2, type: 'string', map: true}
}
export const CreateNamespaceRequest: Schema = {namespace: {no: 1, type: Namespace}}
export const ListNamespacesResponse: Schema = {namespaces: {no: 1, type: Namespace, repeated: true}}

/*
 * Images
 */
export const Image: Schema = {
    name: {no: 1, type: 'string'},
    labels: {no: 2, type: 'string', map: true},
    target: {no: 3, type: Descriptor},
    createdAt: {no: 7, type: Timestamp},
    updatedAt: {no: 8, type: Timestamp}
}
export const GetImageRequest: Schema = {name: {no: 1, type: 'string'}}
export const ImageResponse: Schema = {image: {no: 1, type: Image}}
export const CreateImageRequest: Schema = {image: {no: 1, type: Image}}
export const UpdateImageRequest: Schema = {image: {no: 1, type: Image}, updateMask: {no: 2, type: FieldMask}}
export const ListImagesRequest: Schema = {filters: {no: 1, type: 'string', repeated: true}}
export const ListImagesResponse: Schema = {images: {no: 1, type: Image, repeated: true}}
export const DeleteImageRequest: Schema = {name: {no: 1, type: 'string'}, sync: {no: 2, type: 'bool'}}

/*
 * Content
 */
export const ContentInfo: Schema = {
    digest: {no: 1, type: 'string'},
    size: {no: 2, type: 'int64'},
    createdAt: {no: 3, type: Timestamp},
    updatedAt: {no: 4, type: Timestamp},
    labels: {no: 5, type: 'string', map: true}
}
export const InfoRequest: Schema = {digest: {no: 1, type: 'string'}}
export const InfoResponse: Schema = {info: {no: 1, type: ContentInfo}}
export const UpdateContentRequest: Schema = {info: {no: 1, type: ContentInfo}, updateMask: {no: 2, type: FieldMask}}
export const DeleteContentRequest: Schema = {digest: {no: 1, type: 'string'}}
export const ReadContentRequest: Schema = {
    digest: {no: 1, type: 'string'},
    offset: {no: 2, type: 'int64'},
    size: {no: 3, type: 'int64'}
}
export const ReadContentResponse: Schema = {
    offset: {no: 1, type: 'int64'},
    data: {no: 2, type: 'bytes'}
}

/**
 * The actions of the writes of content
 */
export enum WriteAction {
    STAT = 0,
    WRITE = 1,
    COMMIT = 2
}

export const WriteContentRequest: Schema = {
    action: {no: 1, type: 'enum'},
    ref: {no: 2, type: 'string'},
    total: {no: 3, type: 'int64'},
    expected: {no: 4, type: 'string'},
    offset: {no: 5, type: 'int64'},
    data: {no: 6, type: 'bytes'},
    labels: {no: 7, type: 'string', map: true}
}
export const WriteContentResponse: Schema = {
    action: {no: 1, type: 'enum'},
    offset: {no: 4, type: 'int64'},
    total: {no: 5, type: 'int64'},
    digest: {no: 6, type: 'string'}
}
export const AbortRequest: Schema = {ref: {no: 1, type: 'string'}}

/*
 * Leases
 */
export const Lease: Schema = {
    id: {no: 1, type: 'string'},
    labels: {no: 3, type: 'string', map: true}
}
export const CreateLeaseRequest: Schema = {
    id: {no: 1, type: 'string'},
    labels: {no: 3, type: 'string', map: true}
}
export const CreateLeaseResponse: Schema = {lease: {no: 1, type: Lease}}
export const DeleteLeaseRequest: Schema = {id: {no: 1, type: 'string'}, sync: {no: 2, type: 'bool'}}

/*
 * Snapshots
 */
export const PrepareSnapshotRequest: Schema = {
    snapshotter: {no: 1, type: 'string'},
    key: {no: 2, type: 'string'},
    parent: {no: 3, type: 'string'},
    labels: {no: 4, type: 'string', map: true}
}
export const MountsResponse: Schema = {mounts: {no: 1, type: Mount, repeated: true}}
export const MountsRequest: Schema = {snapshotter: {no: 1, type: 'string'}, key: {no: 2, type: 'string'}}
export const CommitSnapshotRequest: Schema = {
    snapshotter: {no: 1, type: 'string'},
    name: {no: 2, type: 'string'},
    key: {no: 3, type: 'string'},
    labels: {no: 4, type: 'string', map: true}
}
export const SnapshotKeyRequest: Schema = {snapshotter: {no: 1, type: 'string'}, key: {no: 2, type: 'string'}}
export const SnapshotInfo: Schema = {
    name: {no: 1, type: 'string'},
    parent: {no: 2, type: 'string'},
    kind: {no: 3, type: 'enum'},
    createdAt: {no: 4, type: Timestamp},
    updatedAt: {no: 5, type: Timestamp},
    labels: {no: 6, type: 'string', map: true}
}
export const StatSnapshotResponse: Schema = {info: {no: 1, type: SnapshotInfo}}
export const UsageResponse: Schema = {size: {no: 1, type: 'int64'}, inodes: {no: 2, type: 'int64'}}

/*
 * Diff
 */
export const ApplyRequest: Schema = {
    diff: {no: 1, type: Descriptor},
    mounts: {no: 2, type: Mount, repeated: true}
}
export const ApplyResponse: Schema = {applied: {no: 1, type: Descriptor}}

/*
 * Containers
 */
export const ContainerRuntime: Schema = {
    name: {no: 1, type: 'string'},
    options: {no: 2, type: Any}
}
export const Container: Schema = {
    id: {no: 1, type: 'string'},
    labels: {no: 2, type: 'string', map: true},
    image: {no: 3, type: 'string'},
    runtime: {no: 4, type: ContainerRuntime},
    spec: {no: 5, type: Any},
    snapshotter: {no: 6, type: 'string'},
    snapshotKey: {no: 7, type: 'string'},
    createdAt: {no: 8, type: Timestamp},
    updatedAt: {no: 9, type: Timestamp},
    extensions: {no: 10, type: Any, map: true}
}
export const GetContainerRequest: Schema = {id: {no: 1, type: 'string'}}
export const ContainerResponse: Schema = {container: {no: 1, type: Container}}
export const CreateContainerRequest: Schema = {container: {no: 1, type: Container}}
export const UpdateContainerRequest: Schema = {container: {no: 1, type: Container}, updateMask: {no: 2, type: FieldMask}}
export const ListContainersRequest: Schema = {filters: {no: 1, type: 'string', repeated: true}}
export const ListContainersResponse: Schema = {containers: {no: 1, type: Container, repeated: true}}
export const DeleteContainerRequest: Schema = {id: {no: 1, type: 'string'}}

/*
 * Tasks
 */

/**
 * The states of the processes of the tasks
 */
export enum ProcessStatus {
    UNKNOWN = 0,
    CREATED = 1,
    RUNNING = 2,
    STOPPED = 3,
    PAUSED = 4,
    PAUSING = 5
}

export const Process: Schema = {
    containerId: {no: 1, type: 'string'},
    id: {no: 2, type: 'string'},
    pid: {no: 3, type: 'uint32'},
    status: {no: 4, type: 'enum'},
    stdin: {no: 5, type: 'string'},
    stdout: {no: 6, type: 'string'},
    stderr: {no: 7, type: 'string'},
    terminal: {no: 8, type: 'bool'},
    exitStatus: {no: 9, type: 'uint32'},
    exitedAt: {no: 10, type: Timestamp}
}
export const CreateTaskRequest: Schema = {
    containerId: {no: 1, type: 'string'},
    rootfs: {no: 3, type: Mount, repeated: true},
    stdin: {no: 4, type: 'string'},
    stdout: {no: 5, type: 'string'},
    stderr: {no: 6, type: 'string'},
    terminal: {no: 7, type: 'bool'},
    options: {no: 9, type: Any}
}
export const CreateTaskResponse: Schema = {containerId: {no: 1, type: 'string'}, pid: {no: 2, type: 'uint32'}}
export const ProcessRequest: Schema = {containerId: {no: 1, type: 'string'}, execId: {no: 2, type: 'string'}}
export const StartResponse: Schema = {pid: {no: 1, type: 'uint32'}}
export const DeleteTaskRequest: Schema = {containerId: {no: 1, type: 'string'}}
export const DeleteTaskResponse: Schema = {
    id: {no: 1, type: 'string'},
    pid: {no: 2, type: 'uint32'},
    exitStatus: {no: 3, type: 'uint32'},
    exitedAt: {no: 4, type: Timestamp}
}
export const GetTaskResponse: Schema = {process: {no: 1, type: Process}}
export const ListTasksRequest: Schema = {filter: {no: 1, type: 'string'}}
export const ListTasksResponse: Schema = {tasks: {no: 1, type: Process, repeated: true}}
export const KillRequest: Schema = {
    containerId: {no: 1, type: 'string'},
    execId: {no: 2, type: 'string'},
    signal: {no: 3, type: 'uint32'},
    all: {no: 4, type: 'bool'}
}
export const ExecProcessRequest: Schema = {
    containerId: {no: 1, type: 'string'},
    stdin: {no: 2, type: 'string'},
    stdout: {no: 3, type: 'string'},
    stderr: {no: 4, type: 'string'},
    terminal: {no: 5, type: 'bool'},
    spec: {no: 6, type: Any},
    execId: {no: 7, type: 'string'}
}
export const ResizePtyRequest: Schema = {
    containerId: {no: 1, type: 'string'},
    execId: {no: 2, type: 'string'},
    width: {no: 3, type: 'uint32'},
    height: {no: 4, type: 'uint32'}
}
export const CloseIORequest: Schema = {containerId: {no: 1, type: 'string'}, execId: {no: 2, type: 'string'}, stdin: {no: 3, type: 'bool'}}
export const ContainerIdRequest: Schema = {containerId: {no: 1, type: 'string'}}
export const ListPidsResponse: Schema = {processes: {no: 1, type: {pid: {no: 1, type: 'uint32'}}, repeated: true}}
export const WaitResponse: Schema = {exitStatus: {no: 1, type: 'uint32'}, exitedAt: {no: 2, type: Timestamp}}
export const UpdateTaskRequest: Schema = {
    containerId: {no: 1, type: 'string'},
    resources: {no: 2, type: Any},
    annotations: {no: 3, type: 'string', map: true}
}

/*
 * Events
 */
export const SubscribeRequest: Schema = {filters: {no: 1, type: 'string', repeated: true}}
export const Envelope: Schema = {
    timestamp: {no: 1, type: Timestamp},
    namespace: {no: 2, type: 'string'},
    topic: {no: 3, type: 'string'},
    event: {no: 4, type: Any}
}

/**
 * The events of containerd decoded, by their type (the type URL of their Any)
 */
export const EVENTS: Readonly<Record<string, Schema>> = {
    'containerd.events.TaskCreate': {containerId: {no: 1, type: 'string'}, pid: {no: 6, type: 'uint32'}},
    'containerd.events.TaskStart': {containerId: {no: 1, type: 'string'}, pid: {no: 2, type: 'uint32'}},
    'containerd.events.TaskDelete': {containerId: {no: 1, type: 'string'}, pid: {no: 2, type: 'uint32'}, exitStatus: {no: 3, type: 'uint32'}, exitedAt: {no: 4, type: Timestamp}, id: {no: 5, type: 'string'}},
    'containerd.events.TaskExit': {containerId: {no: 1, type: 'string'}, id: {no: 2, type: 'string'}, pid: {no: 3, type: 'uint32'}, exitStatus: {no: 4, type: 'uint32'}, exitedAt: {no: 5, type: Timestamp}},
    'containerd.events.TaskOOM': {containerId: {no: 1, type: 'string'}},
    'containerd.events.TaskExecAdded': {containerId: {no: 1, type: 'string'}, execId: {no: 2, type: 'string'}},
    'containerd.events.TaskExecStarted': {containerId: {no: 1, type: 'string'}, execId: {no: 2, type: 'string'}, pid: {no: 3, type: 'uint32'}},
    'containerd.events.TaskPaused': {containerId: {no: 1, type: 'string'}},
    'containerd.events.TaskResumed': {containerId: {no: 1, type: 'string'}},
    'containerd.events.ContainerCreate': {id: {no: 1, type: 'string'}, image: {no: 2, type: 'string'}},
    'containerd.events.ContainerUpdate': {id: {no: 1, type: 'string'}, image: {no: 2, type: 'string'}, labels: {no: 3, type: 'string', map: true}},
    'containerd.events.ContainerDelete': {id: {no: 1, type: 'string'}},
    'containerd.events.ImageCreate': {name: {no: 1, type: 'string'}, labels: {no: 2, type: 'string', map: true}},
    'containerd.events.ImageUpdate': {name: {no: 1, type: 'string'}, labels: {no: 2, type: 'string', map: true}},
    'containerd.events.ImageDelete': {name: {no: 1, type: 'string'}},
    'containerd.events.SnapshotPrepare': {key: {no: 1, type: 'string'}, parent: {no: 2, type: 'string'}, snapshotter: {no: 5, type: 'string'}},
    'containerd.events.SnapshotCommit': {key: {no: 1, type: 'string'}, name: {no: 2, type: 'string'}, snapshotter: {no: 5, type: 'string'}},
    'containerd.events.SnapshotRemove': {key: {no: 1, type: 'string'}, snapshotter: {no: 5, type: 'string'}}
}

/*
 * The options of the runtime of runc (io.containerd.runc.v2)
 */
export const RuncOptions: Schema = {
    binaryName: {no: 6, type: 'string'},
    root: {no: 7, type: 'string'},
    systemdCgroup: {no: 9, type: 'bool'}
}
