/**
 * The response of the Docker Engine API to the creation of a container (ContainerCreateResponse)
 */
export type ContainerCreateResponse = {
    Id: string
    Warnings?: string[]
}
