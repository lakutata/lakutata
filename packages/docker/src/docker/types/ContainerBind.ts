/**
 * A bind mount of a container: a host file or directory mounted into the container. Read from the container's bind
 * mounts (`DockerContainer.binds`, the named and anonymous volumes excluded), and given to
 * {@link ContainerSettingOptions.binds}, sent to Docker as `"hostPath:containerPath:rw"` or `"hostPath:containerPath:ro"`.
 */
export type ContainerBind = {
    /**
     * The absolute path of the file or directory on the host (`/srv/app/data`).
     */
    hostPath: string
    /**
     * The absolute path where it is mounted in the container (`/data`).
     */
    containerPath: string
    /**
     * `true` when the container can write to it, `false` when it is mounted read-only.
     */
    rw: boolean
}
