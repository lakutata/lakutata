import Dockerode from 'dockerode'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'stream/promises'
import {createInterface} from 'node:readline'
import {Exception} from '../base/abstracts/Exception.js'

/**
 * Docker image push exception
 */
export class DockerImagePushException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_PUSH'
}

export class DockerImage {
    #image: Dockerode.Image

    constructor(rawImage: Dockerode.Image) {
        this.#image = rawImage
    }

    /**
     * Image sha256 id
     */
    public get id(): string {
        return this.#image.id
    }

    /**
     * Export image
     * @param filenameOrWriteStream
     */
    public async export(filenameOrWriteStream: string | NodeJS.WritableStream): Promise<void> {
        const readableStream: NodeJS.ReadableStream = await this.#image.get()
        const destStream: NodeJS.WritableStream = typeof filenameOrWriteStream === 'string'
            ? createWriteStream(filenameOrWriteStream)
            : filenameOrWriteStream
        await pipeline(readableStream, destStream)
    }

    /**
     * Push image
     */
    public async push(): Promise<void>
    /**
     * Push image
     * @param options
     */
    public async push(options: Dockerode.ImagePushOptions): Promise<void>
    /**
     * Push image
     * @param outputCallback
     */
    public async push(outputCallback: (output: Record<string, any>) => void): Promise<void>
    public async push(optionsOrCallback?: Dockerode.ImagePushOptions | ((output: Record<string, any>) => void), outputCallback?: (output: Record<string, any>) => void): Promise<void> {
        const options: Dockerode.ImagePushOptions = optionsOrCallback ? typeof optionsOrCallback === 'function' ? {} : optionsOrCallback : {}
        const callback: ((output: Record<string, any>) => void) | undefined = outputCallback ? outputCallback : optionsOrCallback ? typeof optionsOrCallback === 'function' ? optionsOrCallback : undefined : undefined
        const readableStream: NodeJS.ReadableStream = await this.#image.push(options ? options : {})
        return new Promise((resolve, reject) => {
            let pushException: DockerImagePushException
            createInterface({input: readableStream})
                .on('line', (line: string) => {
                    const outputObject: Record<string, any> = JSON.parse(line)
                    if (outputObject.error) pushException = new DockerImagePushException(outputObject.error)
                    if (callback) callback(outputObject)
                })
                .once('close', () => {
                    if (pushException) return reject(pushException)
                    return resolve()
                })
        })
    }

    /**
     * Inspect image
     */
    public async inspect(): Promise<Dockerode.ImageInspectInfo> {
        return await this.#image.inspect()
    }

    /**
     * Remove image
     * @param options
     */
    public async remove(options?: Dockerode.ImageRemoveOptions): Promise<void> {
        await this.#image.remove(options ? options : {})
    }

    /**
     * Tag image
     * @param options
     */
    public async tag(options: Dockerode.ImageTagOptions): Promise<void> {
        await this.#image.tag(options)
    }

    /**
     * Get image history
     */
    public async history(): Promise<Record<string, any>[]> {
        return await this.#image.history()
    }

    /**
     * Image distribution
     * @param options
     */
    public async distribution(options?: Dockerode.ImageDistributionOptions): Promise<Dockerode.ImageDistributionInfo> {
        return await this.#image.distribution(options ? options : {})
    }
}
