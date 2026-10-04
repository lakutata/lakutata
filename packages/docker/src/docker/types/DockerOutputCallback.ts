/**
 * Receive each progress message of a Docker image operation (pull, push, build), as it arrives: the JSON object sent by
 * the Docker Engine, as `docker pull` displays it (`{status: 'Downloading', id: '<layer>', progressDetail: {current,
 * total}}`, `{error: '…'}`), and for a build, the BuildKit progress as the lines of `docker build --progress=plain`
 * (`{id: 'moby.buildkit.trace', stream: '#2 [1/2] FROM alpine'}`). An error in a message fails the operation once its
 * stream ends.
 */
export type DockerOutputCallback = (output: Record<string, any>) => void
