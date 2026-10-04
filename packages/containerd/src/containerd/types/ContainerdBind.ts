/**
 * A directory or a file of the host mounted into a container (a bind mount), given to
 * {@link ContainerCreateOptions.binds}. Unlike the Docker component's bind, `rw` is optional and the mount propagation
 * can be set.
 */
export type ContainerdBind = {
    /**
     * The path on the host, absolute or relative to the working directory of the process. A missing path is created
     * as a directory when the container is created (as `docker run -v` does).
     */
    hostPath: string
    /**
     * The absolute path in the container where it is mounted; it replaces what the image has there.
     */
    containerPath: string
    /**
     * Whether the container can write to it; `false` mounts it read only.
     * @default true
     */
    rw?: boolean
    /**
     * The mount propagation (how the mounts made later under the path on either side are seen by the other side):
     * `'private'`/`'rprivate'` none, `'shared'`/`'rshared'` both ways, `'slave'`/`'rslave'` from the host into the
     * container only. The `r` forms apply to the mounts under the path too.
     * @default 'rprivate'
     */
    propagation?: 'private' | 'rprivate' | 'shared' | 'rshared' | 'slave' | 'rslave'
}
