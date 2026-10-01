/*
 * The operations of the Docker Engine API used by the Docker component, rewritten from dockerode (Copyright Pedro
 * Dias, Apache License 2.0, see THIRD_PARTY_NOTICES.md): the same endpoints and status codes, the query parameters and
 * the bodies separated, the promises only. The names are in the paths as they are (an image name has "/" and ":"),
 * as dockerode sends them
 */
import type {IncomingMessage} from 'node:http'
import type {Duplex} from 'node:stream'
import {DockerConnection, type DockerConnectionOptions} from './DockerConnection.js'
import {type ContainerCreateResponse} from './types/ContainerCreateResponse.js'
import {type ContainerStopQuery} from './types/ContainerStopQuery.js'
import {type IdResponse} from './types/IdResponse.js'
import {type NetworkCreateResponse} from './types/NetworkCreateResponse.js'
import {type RepositoryTag} from '../docker/types/RepositoryTag.js'

/**
 * The status codes of the requests: the successes, and the reasons of the failures
 */
const SERVER_ERROR: Record<number, string> = {500: 'server error'}
const OK: Record<number, true> = {200: true, 204: true}
const NO_SUCH_IMAGE: Record<number, string> = {404: 'no such image'}
const NO_SUCH_CONTAINER: Record<number, string> = {404: 'no such container'}
const NO_SUCH_EXEC: Record<number, string> = {404: 'no such exec'}
const NO_SUCH_NETWORK: Record<number, string> = {404: 'no such network'}

/**
 * The registry credentials of a request
 */
export type DockerRegistryAuth = {
    username?: string
    password?: string
    serveraddress?: string
    email?: string
    identitytoken?: string
    registrytoken?: string
}

/**
 * The client of the Docker Engine API
 */
export class DockerClient {

    public readonly connection: DockerConnection

    constructor(options: DockerConnectionOptions = {}) {
        this.connection = new DockerConnection(options)
    }

    /**
     * Whether the daemon answers
     * @param signal
     */
    public async ping(signal?: AbortSignal): Promise<string> {
        return await this.connection.request({method: 'GET', path: '/_ping', statusCodes: {200: true, ...SERVER_ERROR}, signal: signal})
    }

    /**
     * The versions of the daemon
     */
    public async version(): Promise<Record<string, any>> {
        return await this.connection.request({method: 'GET', path: '/version', statusCodes: {200: true, ...SERVER_ERROR}})
    }

    /**
     * Check registry credentials (docker login)
     * @param auth
     */
    public async checkAuth(auth: DockerRegistryAuth): Promise<Record<string, any>> {
        return await this.connection.request({method: 'POST', path: '/auth', body: auth, statusCodes: {...OK, ...SERVER_ERROR}})
    }

    /** Images **/

    public async listImages(query?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, any>[]> {
        return await this.connection.request({method: 'GET', path: '/images/json', query: query, statusCodes: {200: true, 400: 'bad parameter', ...SERVER_ERROR}, signal: signal})
    }

    public async inspectImage(name: string, signal?: AbortSignal): Promise<Record<string, any>> {
        return await this.connection.request({method: 'GET', path: `/images/${name}/json`, statusCodes: {200: true, ...NO_SUCH_IMAGE, ...SERVER_ERROR}, signal: signal})
    }

    /**
     * Pull an image: the stream of the progress (docker pull)
     * @param query fromImage, tag, platform
     * @param auth
     * @param signal
     */
    public async pullImage(query: Record<string, unknown>, auth?: DockerRegistryAuth, signal?: AbortSignal): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'POST', path: '/images/create', query: query, auth: auth as Record<string, unknown>, statusCodes: {200: true, ...SERVER_ERROR}, signal: signal})
    }

    /**
     * Build an image: the stream of the progress
     * @param context the gzipped tar archive of the context
     * @param query dockerfile, t, platform, version...
     * @param registryConfig the credentials of the registries, by server
     * @param signal
     */
    public async buildImage(context: NodeJS.ReadableStream, query: Record<string, unknown>, registryConfig?: Record<string, DockerRegistryAuth>, signal?: AbortSignal): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'POST', path: '/build', query: query, body: context, registryConfig: registryConfig, statusCodes: {200: true, ...SERVER_ERROR}, signal: signal})
    }

    /**
     * Load the images of a tar archive (docker load): the stream of the progress
     * @param archive
     * @param query quiet
     */
    public async loadImage(archive: NodeJS.ReadableStream, query?: Record<string, unknown>): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'POST', path: '/images/load', query: query, body: archive, statusCodes: {200: true, ...SERVER_ERROR}})
    }

    /**
     * The tar archive of an image (docker save)
     * @param name
     */
    public async exportImage(name: string): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'GET', path: `/images/${name}/get`, statusCodes: {200: true, ...SERVER_ERROR}})
    }

    public async tagImage(name: string, query: RepositoryTag): Promise<void> {
        await this.connection.request({method: 'POST', path: `/images/${name}/tag`, query: query, statusCodes: {200: true, 201: true, 400: 'bad parameter', ...NO_SUCH_IMAGE, 409: 'conflict', ...SERVER_ERROR}})
    }

    /**
     * Push an image: the stream of the progress
     * @param name
     * @param query tag, platform
     * @param auth
     */
    public async pushImage(name: string, query: Record<string, unknown>, auth?: DockerRegistryAuth): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'POST', path: `/images/${name}/push`, query: query, auth: (auth ?? {}) as Record<string, unknown>, statusCodes: {200: true, ...NO_SUCH_IMAGE, ...SERVER_ERROR}})
    }

    public async removeImage(name: string, query?: { force?: boolean, noprune?: boolean }): Promise<Record<string, any>[]> {
        return await this.connection.request({method: 'DELETE', path: `/images/${name}`, query: query, statusCodes: {200: true, ...NO_SUCH_IMAGE, 409: 'conflict', ...SERVER_ERROR}})
    }

    public async pruneImages(query?: Record<string, unknown>): Promise<Record<string, any>> {
        return await this.connection.request({method: 'POST', path: '/images/prune', query: query, statusCodes: {200: true, ...SERVER_ERROR}})
    }

    /** Containers **/

    public async listContainers(query?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, any>[]> {
        return await this.connection.request({method: 'GET', path: '/containers/json', query: query, statusCodes: {200: true, 400: 'bad parameter', ...SERVER_ERROR}, signal: signal})
    }

    /**
     * Create a container
     * @param body its configuration
     * @param query name, platform
     */
    public async createContainer(body: Record<string, unknown>, query?: { name?: string, platform?: string }): Promise<ContainerCreateResponse> {
        return await this.connection.request({method: 'POST', path: '/containers/create', query: query, body: body, statusCodes: {200: true, 201: true, 400: 'bad parameter', ...NO_SUCH_CONTAINER, 406: 'impossible to attach', ...SERVER_ERROR}})
    }

    public async inspectContainer(id: string, signal?: AbortSignal): Promise<Record<string, any>> {
        return await this.connection.request({method: 'GET', path: `/containers/${id}/json`, statusCodes: {200: true, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}, signal: signal})
    }

    public async startContainer(id: string, signal?: AbortSignal): Promise<void> {
        await this.connection.request({method: 'POST', path: `/containers/${id}/start`, statusCodes: {...OK, 304: 'container already started', ...NO_SUCH_CONTAINER, ...SERVER_ERROR}, signal: signal})
    }

    public async stopContainer(id: string, query?: ContainerStopQuery, signal?: AbortSignal): Promise<void> {
        await this.connection.request({method: 'POST', path: `/containers/${id}/stop`, query: query, statusCodes: {...OK, 304: 'container already stopped', ...NO_SUCH_CONTAINER, ...SERVER_ERROR}, signal: signal})
    }

    public async restartContainer(id: string, query?: ContainerStopQuery, signal?: AbortSignal): Promise<void> {
        await this.connection.request({method: 'POST', path: `/containers/${id}/restart`, query: query, statusCodes: {...OK, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}, signal: signal})
    }

    public async pauseContainer(id: string): Promise<void> {
        await this.connection.request({method: 'POST', path: `/containers/${id}/pause`, statusCodes: {...OK, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    public async unpauseContainer(id: string): Promise<void> {
        await this.connection.request({method: 'POST', path: `/containers/${id}/unpause`, statusCodes: {...OK, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    public async killContainer(id: string, query?: { signal?: string }): Promise<void> {
        await this.connection.request({method: 'POST', path: `/containers/${id}/kill`, query: query, statusCodes: {...OK, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    public async removeContainer(id: string, query?: { v?: boolean, force?: boolean, link?: boolean }): Promise<void> {
        await this.connection.request({method: 'DELETE', path: `/containers/${id}`, query: query, statusCodes: {...OK, 400: 'bad parameter', ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    public async updateContainer(id: string, body: Record<string, unknown>): Promise<Record<string, any>> {
        return await this.connection.request({method: 'POST', path: `/containers/${id}/update`, body: body, statusCodes: {...OK, 400: 'bad parameter', ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    /**
     * Create an image of a container (docker commit)
     * @param id
     * @param query repo, tag, comment, author, pause, changes
     */
    public async commitContainer(id: string, query?: Record<string, unknown>): Promise<IdResponse> {
        return await this.connection.request({method: 'POST', path: '/commit', query: {...query, container: id}, statusCodes: {200: true, 201: true, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    /**
     * The logs of a container: multiplexed when it has no TTY
     * @param id
     * @param query follow, stdout, stderr, since, until, timestamps, tail
     */
    public async containerLogs(id: string, query: Record<string, unknown>): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'GET', path: `/containers/${id}/logs`, query: query, statusCodes: {200: true, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    /**
     * The statistics of a container, once
     * @param id
     */
    public async containerStats(id: string): Promise<Record<string, any>> {
        return await this.connection.request({method: 'GET', path: `/containers/${id}/stats`, query: {'stream': false, 'one-shot': true}, statusCodes: {200: true, ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    /**
     * The tar archive of a path of a container
     * @param id
     * @param query path
     */
    public async getArchive(id: string, query: { path: string }): Promise<IncomingMessage> {
        return await this.connection.stream({method: 'GET', path: `/containers/${id}/archive`, query: query, statusCodes: {200: true, 400: 'client error, bad parameters', ...NO_SUCH_CONTAINER, ...SERVER_ERROR}})
    }

    /**
     * Create an execution in a container
     * @param id
     * @param body Cmd, AttachStdin, AttachStdout, AttachStderr, Tty, ConsoleSize...
     */
    public async createExec(id: string, body: Record<string, unknown>): Promise<IdResponse> {
        return await this.connection.request({method: 'POST', path: `/containers/${id}/exec`, body: body, statusCodes: {200: true, 201: true, ...NO_SUCH_CONTAINER, 409: 'container stopped/paused', ...SERVER_ERROR}})
    }

    /**
     * Start an execution, attached: its stream, read (its output, multiplexed without TTY) and written (its input)
     * @param execId
     * @param body Detach, Tty
     */
    public async startExec(execId: string, body: { Detach?: boolean, Tty?: boolean }): Promise<Duplex> {
        return await this.connection.hijack({method: 'POST', path: `/exec/${execId}/start`, body: body, statusCodes: {...OK, ...NO_SUCH_EXEC, 409: 'container stopped/paused', 500: 'container not running'}})
    }

    public async resizeExec(execId: string, query: { h: number, w: number }): Promise<void> {
        await this.connection.request({method: 'POST', path: `/exec/${execId}/resize`, query: query, statusCodes: {...OK, ...NO_SUCH_EXEC, 500: 'container not running'}})
    }

    public async inspectExec(execId: string): Promise<Record<string, any>> {
        return await this.connection.request({method: 'GET', path: `/exec/${execId}/json`, statusCodes: {200: true, ...NO_SUCH_EXEC, ...SERVER_ERROR}})
    }

    public async pruneContainers(query?: Record<string, unknown>): Promise<Record<string, any>> {
        return await this.connection.request({method: 'POST', path: '/containers/prune', query: query, statusCodes: {200: true, ...SERVER_ERROR}})
    }

    /** Networks **/

    public async listNetworks(query?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, any>[]> {
        return await this.connection.request({method: 'GET', path: '/networks', query: query, statusCodes: {200: true, 400: 'bad parameter', ...SERVER_ERROR}, signal: signal})
    }

    public async createNetwork(body: Record<string, unknown>): Promise<NetworkCreateResponse> {
        return await this.connection.request({method: 'POST', path: '/networks/create', body: body, statusCodes: {200: true, 201: true, 404: 'driver not found', ...SERVER_ERROR}})
    }

    public async inspectNetwork(id: string): Promise<Record<string, any>> {
        return await this.connection.request({method: 'GET', path: `/networks/${id}`, statusCodes: {200: true, ...NO_SUCH_NETWORK, ...SERVER_ERROR}})
    }

    public async removeNetwork(id: string): Promise<void> {
        await this.connection.request({method: 'DELETE', path: `/networks/${id}`, statusCodes: {...OK, ...NO_SUCH_NETWORK, 409: 'conflict', ...SERVER_ERROR}})
    }

    public async pruneNetworks(query?: Record<string, unknown>): Promise<Record<string, any>> {
        return await this.connection.request({method: 'POST', path: '/networks/prune', query: query, statusCodes: {200: true, ...SERVER_ERROR}})
    }

    /** Volumes **/

    public async pruneVolumes(query?: Record<string, unknown>): Promise<Record<string, any>> {
        return await this.connection.request({method: 'POST', path: '/volumes/prune', query: query, statusCodes: {200: true, ...SERVER_ERROR}})
    }

    /**
     * Close the connections kept alive
     */
    public close(): void {
        this.connection.close()
    }
}
