import {mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'

/**
 * A named volume: a directory of the data root mounted in the containers
 */
export type Volume = {
    name: string
    /**
     * Its directory of the host (mounted in the containers)
     */
    mountpoint: string
    labels: Record<string, string>
    createdAt: Date
}

/**
 * The named volumes of a namespace: <data root>/volumes/<namespace>/<name>/_data, their information in volume.json
 */
export class VolumeStore {

    constructor(public readonly directory: string) {
    }

    /**
     * Whether a name is the one of a volume
     * @param name
     */
    public static ValidName(name: string): boolean {
        return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)
    }

    protected path(name: string): string {
        if (!VolumeStore.ValidName(name)) throw new Error(`The name of a volume "${name}" is not valid ([a-zA-Z0-9][a-zA-Z0-9_.-]*)`)
        return path.join(this.directory, name)
    }

    /**
     * A volume, undefined when it does not exist
     * @param name
     */
    public async get(name: string): Promise<Volume | undefined> {
        const directory: string = this.path(name)
        try {
            const info = JSON.parse(await readFile(path.join(directory, 'volume.json'), 'utf8')) as { labels?: Record<string, string>, createdAt?: string }
            return {name: name, mountpoint: path.join(directory, '_data'), labels: info.labels ?? {}, createdAt: new Date(info.createdAt ?? (await stat(directory)).birthtime)}
        } catch {
            return undefined
        }
    }

    public async list(): Promise<Volume[]> {
        let names: string[]
        try {
            names = (await readdir(this.directory)).filter(VolumeStore.ValidName).sort()
        } catch {
            return []
        }
        const volumes: Volume[] = []
        for (const name of names) {
            const volume: Volume | undefined = await this.get(name)
            if (volume) volumes.push(volume)
        }
        return volumes
    }

    /**
     * Create a volume (the existing one is given when it exists, as Docker does)
     * @param name
     * @param labels
     */
    public async create(name: string, labels: Record<string, string> = {}): Promise<Volume> {
        const existing: Volume | undefined = await this.get(name)
        if (existing) return existing
        const directory: string = this.path(name)
        await mkdir(path.join(directory, '_data'), {recursive: true})
        await writeFile(path.join(directory, 'volume.json'), JSON.stringify({name: name, labels: labels, createdAt: new Date().toISOString()}))
        return (await this.get(name))!
    }

    /**
     * Remove a volume and its data
     * @param name
     */
    public async remove(name: string): Promise<void> {
        await rm(this.path(name), {recursive: true, force: true})
    }
}
