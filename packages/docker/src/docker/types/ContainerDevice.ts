/**
 * A host device made available in a container (`docker run --device`). Read from the container's settings
 * (`DockerContainer.devices`) and given to {@link ContainerSettingOptions.devices}.
 */
export type ContainerDevice = {
    /**
     * The path of the device on the host (`/dev/ttyUSB0`).
     */
    hostPath: string
    /**
     * The path of the device in the container (`/dev/ttyUSB0`).
     */
    containerPath: string
    /**
     * What the container's cgroup allows on the device: a combination of `r` (read), `w` (write) and `m` (create
     * device nodes with mknod), `"rwm"` for all of them.
     */
    cgroupPermissions: string
}
