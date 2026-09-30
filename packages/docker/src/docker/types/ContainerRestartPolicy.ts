/**
 * "" Empty string means not to restart
 * "no" Do not automatically restart
 * "always" Always restart
 * "unless-stopped" Restart always except when the user has manually stopped the container
 * "on-failure" Restart only when the container exit code is non-zero
 */
export type ContainerRestartPolicy = '' | 'no' | 'always' | 'unless-stopped' | 'on-failure'
