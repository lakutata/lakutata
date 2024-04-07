import {ImageExposePort} from './ImageExposePort.js'

export type ImageConfig = {
    hostname: string
    user: string
    env: Record<string, string>
    cmd: string[]
    entrypoint: string[]
    volumes: string[]
    ports: ImageExposePort[]
}
