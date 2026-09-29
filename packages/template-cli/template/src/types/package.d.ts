/**
 * The package.json of the project, imported by the application for its name and its version: tsc keeps the import, node
 * reads the file (build/ and src/ are next to it), the bundles embed it
 */
declare module '*/package.json' {
    const manifest: {
        name: string
        version: string
        description?: string
    }
    export = manifest
}
