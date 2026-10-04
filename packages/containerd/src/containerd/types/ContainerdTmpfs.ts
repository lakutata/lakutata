/**
 * A tmpfs (a file system in memory, lost when the container stops) mounted into a container
 * ({@link ContainerCreateOptions.tmpfs}), with the mount options `nosuid`, `nodev` and `noexec`.
 */
export type ContainerdTmpfs = {
    /**
     * The absolute path in the container where it is mounted.
     */
    containerPath: string
    /**
     * Its maximum size in bytes, a positive integer; the kernel's default (half of the host memory) when not given.
     * Its pages count in the container's memory use.
     */
    size?: number
    /**
     * The permissions of its root directory, three or four octal digits (`'1777'`, `'755'`); the kernel's default
     * (`1777`) when not given.
     */
    mode?: string
}
