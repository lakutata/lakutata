export type ContainerPort = {
    host: string
    port: number
    type: 'tcp' | 'udp'
    hostPorts: number[]
}
