/**
 * Receive the progress of a BuildKit build ({@link ImageBuildOptions.outputCallback}), one line per call, as
 * `docker build --progress=plain` prints it: the steps numbered in their order (`"#3 [2/2] RUN npm ci"`), their output,
 * and their end (`"#3 CACHED"`, `"#3 DONE 1.2s"`, or their error). The line has no trailing newline.
 */
export type ContainerdBuildOutputCallback = (line: string) => void
