/**
 * The environment the tool was started with: the application of the tool sets some variables (NODE_ENV from its mode…),
 * the commands it runs (the scripts of the packages, the installations) are given the environment of the user
 */
export const LaunchEnvironment: NodeJS.ProcessEnv = {...process.env}
