export type ContainerdImageConfig = {
    env: Record<string, string>
    cmd: string[]
    entrypoint: string[]
    workingDir: string
    user: string
    exposedPorts: { port: number, type: 'tcp' | 'udp' | 'sctp' }[]
    volumes: string[]
    labels: Record<string, string>
    stopSignal?: string
}
