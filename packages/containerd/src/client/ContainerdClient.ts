import {randomBytes} from 'node:crypto'
import {GRPCConnection, GRPCError, GRPCStatus, type CallOptions, Decode, type Message, type Schema} from '@lakutata/grpc'
import * as M from './Messages.js'

/**
 * A descriptor of content (OCI)
 */
export type ContentDescriptor = {
    mediaType: string
    digest: string
    size: number
    annotations?: Record<string, string>
    platform?: { os: string, architecture: string, variant?: string }
}

/**
 * A mount of a snapshot
 */
export type SnapshotMount = {
    type: string
    source: string
    target?: string
    options: string[]
}

/**
 * An event of containerd: its topic (/tasks/exit), its type (containerd.events.TaskExit) and its fields
 */
export type ContainerdEvent = {
    timestamp: Date
    namespace: string
    topic: string
    type: string
    event: Message
}

/**
 * The prefix of the paths of the services of containerd
 */
const SERVICES: string = '/containerd.services'

/**
 * The type URL of the specifications of the containers and of their processes (OCI runtime spec, JSON)
 */
export const SPEC_TYPE_URL: string = 'types.containerd.io/opencontainers/runtime-spec/1/Spec'
export const PROCESS_TYPE_URL: string = 'types.containerd.io/opencontainers/runtime-spec/1/Process'
export const RESOURCES_TYPE_URL: string = 'types.containerd.io/opencontainers/runtime-spec/1/LinuxResources'

/**
 * A date of a Timestamp
 * @param timestamp
 */
export function TimestampDate(timestamp: Message | undefined): Date | undefined {
    if (!timestamp) return undefined
    return new Date(Number(timestamp.seconds ?? 0) * 1000 + Math.floor(Number(timestamp.nanos ?? 0) / 1e6))
}

/**
 * Whether an error is the one of a call of a code
 * @param error
 * @param code
 */
export function IsGRPCError(error: unknown, code: number): error is GRPCError {
    return error instanceof GRPCError && error.code === code
}

/**
 * The client of the API of containerd (its services of the version 1), in a namespace: its calls are the ones of
 * ctr and nerdctl
 */
export class ContainerdClient {

    public readonly grpc: GRPCConnection

    constructor(socketPath: string, public readonly namespace: string) {
        this.grpc = new GRPCConnection(socketPath)
    }

    /**
     * The options of a call: its namespace, its lease (the content and the snapshots it creates are kept by it until
     * they are referenced)
     * @param lease
     * @param signal
     */
    protected options(lease?: string, signal?: AbortSignal): CallOptions {
        return {metadata: {'containerd-namespace': this.namespace, 'containerd-lease': lease}, signal: signal}
    }

    /**
     * Call a method of a service
     * @param service its name and its version (images.v1.Images)
     * @param method
     * @param requestSchema
     * @param request
     * @param responseSchema
     * @param lease
     * @param signal
     */
    protected call(service: string, method: string, requestSchema: Schema, request: Message, responseSchema: Schema = M.Empty, lease?: string, signal?: AbortSignal): Promise<Message> {
        return this.grpc.unary(`${SERVICES}.${service}/${method}`, requestSchema, request, responseSchema, this.options(lease, signal))
    }

    /**
     * Call a method, undefined when what it reads does not exist
     * @param promise
     */
    protected async orUndefined<T>(promise: Promise<T>): Promise<T | undefined> {
        try {
            return await promise
        } catch (error: unknown) {
            if (IsGRPCError(error, GRPCStatus.NOT_FOUND)) return undefined
            throw error
        }
    }

    /*
     * Version, namespaces
     */

    public async version(): Promise<{ version: string, revision: string }> {
        return await this.call('version.v1.Version', 'Version', M.Empty, {}, M.VersionResponse) as { version: string, revision: string }
    }

    /**
     * Create the namespace of the client, when it does not exist
     */
    public async ensureNamespace(): Promise<void> {
        try {
            await this.call('namespaces.v1.Namespaces', 'Create', M.CreateNamespaceRequest, {namespace: {name: this.namespace}}, M.Empty)
        } catch (error: unknown) {
            if (!IsGRPCError(error, GRPCStatus.ALREADY_EXISTS)) throw error
        }
    }

    /*
     * Leases
     */

    /**
     * Create a lease, which keeps what is created under it until it is deleted (or expired)
     * @param expireSeconds
     */
    public async createLease(expireSeconds: number = 24 * 3600): Promise<string> {
        const id: string = `lakutata-${Date.now()}-${randomBytes(4).toString('hex')}`
        const expire: string = new Date(Date.now() + expireSeconds * 1000).toISOString()
        await this.call('leases.v1.Leases', 'Create', M.CreateLeaseRequest, {id: id, labels: {'containerd.io/gc.expire': expire}}, M.CreateLeaseResponse)
        return id
    }

    public async deleteLease(id: string): Promise<void> {
        await this.orUndefined(this.call('leases.v1.Leases', 'Delete', M.DeleteLeaseRequest, {id: id}))
    }

    /*
     * Images
     */

    public async getImage(name: string): Promise<Message | undefined> {
        return (await this.orUndefined(this.call('images.v1.Images', 'Get', M.GetImageRequest, {name: name}, M.ImageResponse)))?.image
    }

    public async listImages(filters: string[] = []): Promise<Message[]> {
        return (await this.call('images.v1.Images', 'List', M.ListImagesRequest, {filters: filters}, M.ListImagesResponse)).images
    }

    /**
     * Create an image, or update it when it exists (its target and its labels)
     * @param image
     * @param lease
     */
    public async putImage(image: Message, lease?: string): Promise<Message> {
        try {
            return (await this.call('images.v1.Images', 'Create', M.CreateImageRequest, {image: image}, M.ImageResponse, lease)).image
        } catch (error: unknown) {
            if (!IsGRPCError(error, GRPCStatus.ALREADY_EXISTS)) throw error
            return (await this.call('images.v1.Images', 'Update', M.UpdateImageRequest, {image: image, updateMask: {paths: ['target', 'labels']}}, M.ImageResponse, lease)).image
        }
    }

    public async deleteImage(name: string, sync: boolean = false): Promise<void> {
        await this.call('images.v1.Images', 'Delete', M.DeleteImageRequest, {name: name, sync: sync})
    }

    /*
     * Content
     */

    public async contentInfo(digest: string): Promise<Message | undefined> {
        return (await this.orUndefined(this.call('content.v1.Content', 'Info', M.InfoRequest, {digest: digest}, M.InfoResponse)))?.info
    }

    /**
     * Set labels of a content
     * @param digest
     * @param labels
     */
    public async labelContent(digest: string, labels: Record<string, string>): Promise<void> {
        if (!Object.keys(labels).length) return
        await this.call('content.v1.Content', 'Update', M.UpdateContentRequest, {
            info: {digest: digest, labels: labels},
            updateMask: {paths: Object.keys(labels).map((key: string): string => `labels.${key}`)}
        }, M.InfoResponse)
    }

    /**
     * Read a content, by its chunks
     * @param digest
     * @param signal
     */
    public async* readContent(digest: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
        const responses: AsyncIterableIterator<Message> = this.grpc.serverStream(`${SERVICES}.content.v1.Content/Read`, M.ReadContentRequest, {digest: digest}, M.ReadContentResponse, this.options(undefined, signal))
        for await (const response of responses) if (response.data?.length) yield response.data as Buffer
    }

    /**
     * Read a content whole
     * @param digest
     */
    public async readAll(digest: string): Promise<Buffer> {
        const chunks: Buffer[] = []
        for await (const chunk of this.readContent(digest)) chunks.push(chunk)
        return Buffer.concat(chunks)
    }

    /**
     * Write a content, checked by its digest (a content which exists is kept), its labels set
     * @param descriptor its digest and its size
     * @param data its bytes, or their chunks
     * @param lease
     * @param labels
     * @param signal
     */
    public async writeContent(descriptor: { digest: string, size: number }, data: Uint8Array | AsyncIterable<Uint8Array>, lease: string, labels: Record<string, string> = {}, signal?: AbortSignal): Promise<void> {
        if (await this.contentInfo(descriptor.digest)) {
            await this.labelContent(descriptor.digest, labels)
            return
        }
        const ref: string = `lakutata-${descriptor.digest}-${randomBytes(4).toString('hex')}`
        const stream = this.grpc.bidi(`${SERVICES}.content.v1.Content/Write`, M.WriteContentRequest, M.WriteContentResponse, this.options(lease, signal))
        //The responses read while the requests are sent (one by request)
        const responses: Promise<Message[]> = (async (): Promise<Message[]> => {
            const all: Message[] = []
            for await (const response of stream.responses) all.push(response)
            return all
        })()
        responses.catch((): void => undefined)
        try {
            let offset: number = 0
            const send = async (chunk: Uint8Array): Promise<void> => {
                //Messages of 1 MiB at most (the maximum message of gRPC is 4 MiB)
                for (let start = 0; start < chunk.length; start += 1024 * 1024) {
                    const part: Uint8Array = chunk.subarray(start, start + 1024 * 1024)
                    await stream.send({action: M.WriteAction.WRITE, ref: ref, total: descriptor.size, expected: descriptor.digest, offset: offset, data: part})
                    offset += part.length
                }
            }
            if (data instanceof Uint8Array) await send(data)
            else for await (const chunk of data) await send(chunk)
            await stream.send({action: M.WriteAction.COMMIT, ref: ref, total: descriptor.size, expected: descriptor.digest, offset: offset, labels: labels})
            stream.end()
            const answers: Message[] = await responses
            const committed: Message | undefined = answers.find((answer: Message): boolean => answer.action === M.WriteAction.COMMIT)
            if (committed && committed.digest !== descriptor.digest) throw new Error(`The content written is ${committed.digest}, not ${descriptor.digest}`)
        } catch (error: unknown) {
            stream.cancel()
            //Written by another writer meanwhile
            if (IsGRPCError(error, GRPCStatus.ALREADY_EXISTS) || (await this.contentInfo(descriptor.digest))) {
                await this.labelContent(descriptor.digest, labels)
                return
            }
            await this.orUndefined(this.call('content.v1.Content', 'Abort', M.AbortRequest, {ref: ref}))
            throw error
        }
    }

    public async deleteContent(digest: string): Promise<void> {
        await this.orUndefined(this.call('content.v1.Content', 'Delete', M.DeleteContentRequest, {digest: digest}))
    }

    /*
     * Snapshots, diff
     */

    public async prepareSnapshot(snapshotter: string, key: string, parent: string, labels: Record<string, string> = {}, lease?: string): Promise<SnapshotMount[]> {
        return (await this.call('snapshots.v1.Snapshots', 'Prepare', M.PrepareSnapshotRequest, {snapshotter: snapshotter, key: key, parent: parent, labels: labels}, M.MountsResponse, lease)).mounts as SnapshotMount[]
    }

    public async snapshotMounts(snapshotter: string, key: string): Promise<SnapshotMount[]> {
        return (await this.call('snapshots.v1.Snapshots', 'Mounts', M.MountsRequest, {snapshotter: snapshotter, key: key}, M.MountsResponse)).mounts as SnapshotMount[]
    }

    public async commitSnapshot(snapshotter: string, name: string, key: string, labels: Record<string, string> = {}, lease?: string): Promise<void> {
        await this.call('snapshots.v1.Snapshots', 'Commit', M.CommitSnapshotRequest, {snapshotter: snapshotter, name: name, key: key, labels: labels}, M.Empty, lease)
    }

    public async viewSnapshot(snapshotter: string, key: string, parent: string, lease?: string): Promise<SnapshotMount[]> {
        return (await this.call('snapshots.v1.Snapshots', 'View', M.PrepareSnapshotRequest, {snapshotter: snapshotter, key: key, parent: parent}, M.MountsResponse, lease)).mounts as SnapshotMount[]
    }

    /**
     * The layer of the changes of a snapshot from another one (tar+gzip), written into the content store
     * @param left the older one
     * @param right the newer one
     * @param lease
     */
    public async diff(left: SnapshotMount[], right: SnapshotMount[], lease?: string): Promise<ContentDescriptor> {
        return (await this.call('diff.v1.Diff', 'Diff', M.DiffRequest, {left: left, right: right, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip'}, M.DiffResponse, lease)).diff as ContentDescriptor
    }

    /**
     * The metrics of the cgroup of a task: their type (io.containerd.cgroups.v1.Metrics, …v2.Metrics) and their bytes
     * @param containerId
     */
    public async metrics(containerId: string): Promise<Message | undefined> {
        return (await this.call('tasks.v1.Tasks', 'Metrics', M.MetricsRequest, {filters: [`id==${containerId}`]}, M.MetricsResponse)).metrics[0]
    }

    public async removeSnapshot(snapshotter: string, key: string): Promise<void> {
        await this.orUndefined(this.call('snapshots.v1.Snapshots', 'Remove', M.SnapshotKeyRequest, {snapshotter: snapshotter, key: key}))
    }

    public async statSnapshot(snapshotter: string, key: string): Promise<Message | undefined> {
        return (await this.orUndefined(this.call('snapshots.v1.Snapshots', 'Stat', M.SnapshotKeyRequest, {snapshotter: snapshotter, key: key}, M.StatSnapshotResponse)))?.info
    }

    public async snapshotUsage(snapshotter: string, key: string): Promise<{ size: number, inodes: number }> {
        return await this.call('snapshots.v1.Snapshots', 'Usage', M.SnapshotKeyRequest, {snapshotter: snapshotter, key: key}, M.UsageResponse) as { size: number, inodes: number }
    }

    /**
     * Apply a layer (its content) to the mounts of a snapshot
     * @param layer
     * @param mounts
     * @param lease
     */
    public async applyLayer(layer: ContentDescriptor, mounts: SnapshotMount[], lease?: string): Promise<ContentDescriptor> {
        return (await this.call('diff.v1.Diff', 'Apply', M.ApplyRequest, {diff: {mediaType: layer.mediaType, digest: layer.digest, size: layer.size}, mounts: mounts}, M.ApplyResponse, lease)).applied as ContentDescriptor
    }

    /*
     * Containers
     */

    public async getContainer(id: string): Promise<Message | undefined> {
        return (await this.orUndefined(this.call('containers.v1.Containers', 'Get', M.GetContainerRequest, {id: id}, M.ContainerResponse)))?.container
    }

    public async listContainers(filters: string[] = []): Promise<Message[]> {
        return (await this.call('containers.v1.Containers', 'List', M.ListContainersRequest, {filters: filters}, M.ListContainersResponse)).containers
    }

    public async createContainer(container: Message, lease?: string): Promise<Message> {
        return (await this.call('containers.v1.Containers', 'Create', M.CreateContainerRequest, {container: container}, M.ContainerResponse, lease)).container
    }

    public async updateContainer(container: Message, paths: string[]): Promise<Message> {
        return (await this.call('containers.v1.Containers', 'Update', M.UpdateContainerRequest, {container: container, updateMask: {paths: paths}}, M.ContainerResponse)).container
    }

    public async deleteContainer(id: string): Promise<void> {
        await this.orUndefined(this.call('containers.v1.Containers', 'Delete', M.DeleteContainerRequest, {id: id}))
    }

    /*
     * Tasks
     */

    public async createTask(request: Message): Promise<number> {
        return (await this.call('tasks.v1.Tasks', 'Create', M.CreateTaskRequest, request, M.CreateTaskResponse)).pid ?? 0
    }

    public async startTask(containerId: string, execId: string = ''): Promise<number> {
        return (await this.call('tasks.v1.Tasks', 'Start', M.ProcessRequest, {containerId: containerId, execId: execId}, M.StartResponse)).pid ?? 0
    }

    public async deleteTask(containerId: string): Promise<Message | undefined> {
        return await this.orUndefined(this.call('tasks.v1.Tasks', 'Delete', M.DeleteTaskRequest, {containerId: containerId}, M.DeleteTaskResponse))
    }

    public async deleteProcess(containerId: string, execId: string): Promise<Message | undefined> {
        return await this.orUndefined(this.call('tasks.v1.Tasks', 'DeleteProcess', M.ProcessRequest, {containerId: containerId, execId: execId}, M.DeleteTaskResponse))
    }

    public async getTask(containerId: string, execId: string = ''): Promise<Message | undefined> {
        return (await this.orUndefined(this.call('tasks.v1.Tasks', 'Get', M.ProcessRequest, {containerId: containerId, execId: execId}, M.GetTaskResponse)))?.process
    }

    public async listTasks(): Promise<Message[]> {
        return (await this.call('tasks.v1.Tasks', 'List', M.ListTasksRequest, {}, M.ListTasksResponse)).tasks
    }

    public async kill(containerId: string, signal: number, options: { execId?: string, all?: boolean } = {}): Promise<void> {
        await this.call('tasks.v1.Tasks', 'Kill', M.KillRequest, {containerId: containerId, execId: options.execId ?? '', signal: signal, all: options.all ?? false})
    }

    public async exec(request: Message): Promise<void> {
        await this.call('tasks.v1.Tasks', 'Exec', M.ExecProcessRequest, request)
    }

    public async resizePty(containerId: string, execId: string, width: number, height: number): Promise<void> {
        await this.call('tasks.v1.Tasks', 'ResizePty', M.ResizePtyRequest, {containerId: containerId, execId: execId, width: width, height: height})
    }

    public async closeIO(containerId: string, execId: string): Promise<void> {
        await this.call('tasks.v1.Tasks', 'CloseIO', M.CloseIORequest, {containerId: containerId, execId: execId, stdin: true})
    }

    public async pause(containerId: string): Promise<void> {
        await this.call('tasks.v1.Tasks', 'Pause', M.ContainerIdRequest, {containerId: containerId})
    }

    public async resume(containerId: string): Promise<void> {
        await this.call('tasks.v1.Tasks', 'Resume', M.ContainerIdRequest, {containerId: containerId})
    }

    public async listPids(containerId: string): Promise<number[]> {
        return (await this.call('tasks.v1.Tasks', 'ListPids', M.ContainerIdRequest, {containerId: containerId}, M.ListPidsResponse)).processes.map((process: Message): number => process.pid)
    }

    /**
     * Wait for a process to exit (the task, an exec)
     * @param containerId
     * @param execId
     * @param signal
     */
    public async wait(containerId: string, execId: string = '', signal?: AbortSignal): Promise<{ exitStatus: number, exitedAt?: Date }> {
        const response: Message = await this.call('tasks.v1.Tasks', 'Wait', M.ProcessRequest, {containerId: containerId, execId: execId}, M.WaitResponse, undefined, signal)
        return {exitStatus: response.exitStatus ?? 0, exitedAt: TimestampDate(response.exitedAt)}
    }

    /**
     * Update the resources of a task (OCI LinuxResources)
     * @param containerId
     * @param resources
     */
    public async updateTask(containerId: string, resources: object): Promise<void> {
        await this.call('tasks.v1.Tasks', 'Update', M.UpdateTaskRequest, {containerId: containerId, resources: {typeUrl: RESOURCES_TYPE_URL, value: Buffer.from(JSON.stringify(resources))}})
    }

    /*
     * Events
     */

    /**
     * The events of containerd, their fields decoded (the ones of the tasks, the containers and the images)
     * @param filters the filters of containerd (topic~="/tasks/", namespace==default)
     * @param signal its end
     */
    public async* subscribe(filters: string[] = [], signal?: AbortSignal): AsyncGenerator<ContainerdEvent> {
        //The events of all the namespaces: filtered by namespace
        const responses: AsyncIterableIterator<Message> = this.grpc.serverStream(`${SERVICES}.events.v1.Events/Subscribe`, M.SubscribeRequest, {filters: filters}, M.Envelope, {signal: signal})
        try {
            for await (const envelope of responses) {
                const type: string = String(envelope.event?.typeUrl ?? '')
                const schema: Schema | undefined = M.EVENTS[type]
                yield {
                    timestamp: TimestampDate(envelope.timestamp) ?? new Date(),
                    namespace: envelope.namespace ?? '',
                    topic: envelope.topic ?? '',
                    type: type,
                    event: schema && envelope.event?.value ? Decode(schema, envelope.event.value) : {}
                }
            }
        } catch (error: unknown) {
            if (signal?.aborted && IsGRPCError(error, GRPCStatus.CANCELLED)) return
            throw error
        }
    }

    /**
     * An Any of JSON (the specifications of OCI)
     * @param typeUrl
     * @param value
     */
    public static Json(typeUrl: string, value: object): Message {
        return {typeUrl: typeUrl, value: Buffer.from(JSON.stringify(value))}
    }

    /**
     * The value of an Any of JSON
     * @param any
     */
    public static FromJson<T = any>(any: Message | undefined): T | undefined {
        if (!any?.value?.length) return undefined
        return JSON.parse(Buffer.from(any.value).toString('utf8')) as T
    }

    /**
     * Close the connection
     */
    public close(): void {
        this.grpc.close()
    }
}

