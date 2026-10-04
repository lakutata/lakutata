/**
 * A port exposed by an image (its Dockerfile's `EXPOSE`), with its protocols (`DockerImage.config.ports`).
 */
export type ImageExposePort = {
    /**
     * The port in the container (`80`).
     */
    port: number
    /**
     * `true` when the port is exposed for TCP.
     */
    tcp: boolean
    /**
     * `true` when the port is exposed for UDP.
     */
    udp: boolean
}
