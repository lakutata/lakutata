/**
 * The query of stopping or restarting a container in the Docker Engine API
 */
export type ContainerStopQuery = {
    /**
     * The number of seconds to wait before killing the container
     */
    t?: number
    /**
     * The signal to send to the container
     */
    signal?: string
}
