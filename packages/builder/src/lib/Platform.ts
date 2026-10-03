/**
 * The C library of Linux: the executables made on it run on the systems of the same library (undefined out of Linux)
 */
export function Libc(): 'glibc' | 'musl' | undefined {
    if (process.platform !== 'linux') return undefined
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    return report?.header?.glibcVersionRuntime ? 'glibc' : 'musl'
}
