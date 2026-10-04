import {ImageExposePort} from './ImageExposePort.js'

/**
 * The run settings an image gives its containers by default, from its Dockerfile (`DockerImage.config`).
 */
export type ImageConfig = {
    /**
     * The containers' default host name, usually empty.
     */
    hostname: string
    /**
     * The user the containers' processes run as (`USER`: `"node"`, `"1000:1000"`), an empty string for root.
     */
    user: string
    /**
     * The environment variables (`ENV`), by name.
     */
    env: Record<string, string>
    /**
     * The default command (`CMD`), as its arguments. Docker reports `null` for an image without one.
     */
    cmd: string[]
    /**
     * The entry point (`ENTRYPOINT`), as its arguments, empty when the image has none.
     */
    entrypoint: string[]
    /**
     * The container paths of the image's volumes (`VOLUME`: `/var/lib/postgresql/data`).
     */
    volumes: string[]
    /**
     * The exposed ports (`EXPOSE`).
     */
    ports: ImageExposePort[]
}
