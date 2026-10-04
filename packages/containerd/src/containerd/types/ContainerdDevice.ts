/**
 * A host device given to a container ({@link ContainerCreateOptions.devices}): its device node created in the
 * container, and its access allowed by the container's device cgroup. Unlike the Docker component's device,
 * `containerPath` is optional and `hostPath` may be a directory.
 */
export type ContainerdDevice = {
    /**
     * The device node on the host (`/dev/ttyUSB0`), or a directory whose device nodes are all given (`/dev/snd`), the
     * subdirectories included and the other files skipped. A path which is neither fails the creation of the
     * container. The devices are read when the container is created: a device plugged later needs
     * {@link ContainerCreateOptions.deviceCgroupRules} and a bind mount of its directory.
     */
    hostPath: string
    /**
     * The path of the device node in the container (for a directory, the directory its nodes are created in).
     * @default hostPath
     */
    containerPath?: string
    /**
     * The access the cgroup allows: one to three of `r` (read), `w` (write) and `m` (mknod), each at most once, in any
     * order: `"rwm"`, `"rw"`, `"r"`.
     * @default 'rwm'
     */
    cgroupPermissions?: string
}
