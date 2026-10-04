/**
 * A named volume mounted into a container ({@link ContainerCreateOptions.volumes}): a directory the component keeps in
 * its data root, which outlives the container. It is not a nerdctl volume.
 */
export type ContainerdVolume = {
    /**
     * The name of the volume (`[a-zA-Z0-9][a-zA-Z0-9_.-]*`), created empty when it does not exist.
     */
    volumeName: string
    /**
     * The absolute path in the container where it is mounted.
     */
    containerPath: string
    /**
     * Whether it is mounted read only.
     * @default false
     */
    readonly?: boolean
}
