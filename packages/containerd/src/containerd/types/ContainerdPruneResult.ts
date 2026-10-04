export type ContainerdPruneResult = {
    /**
     * The identifiers of the containers removed
     */
    containers: string[]
    /**
     * The names of the images removed
     */
    images: string[]
    networks: string[]
    volumes: string[]
}
