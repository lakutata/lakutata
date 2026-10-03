/**
 * A line of the progress of a build ("#3 [2/2] RUN npm ci", "#3 DONE 1.2s")
 */
export type ContainerdBuildOutputCallback = (line: string) => void
