/**
 * What {@link Containerd.prune} removed. A resource whose removal failed is not listed.
 */
export type ContainerdPruneResult = {
    /**
     * The IDs of the containers removed.
     */
    containers: string[]
    /**
     * The names of the images removed (`'docker.io/library/alpine:3.20'`, or a digest reference for a dangling one).
     */
    images: string[]
    /**
     * The names of the networks removed.
     */
    networks: string[]
    /**
     * The names of the volumes removed, their data deleted.
     */
    volumes: string[]
}
