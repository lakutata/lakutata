/**
 * postject (the tool of Node.js injecting the single executable applications) has no types
 */
declare module 'postject' {
    export type InjectOptions = {
        /**
         * The fuse flipped in the binary once the resource is injected
         */
        sentinelFuse?: string
        /**
         * The segment of the resource in a Mach-O binary
         */
        machoSegmentName?: string
        overwrite?: boolean
    }

    export function inject(filename: string, resourceName: string, resourceData: Buffer, options?: InjectOptions): Promise<void>
}
