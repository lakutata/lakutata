/**
 * The environment the tool was started with: the application of the tool sets some variables (NODE_ENV from its mode…),
 * the commands it runs (the scripts of the packages, the installations) are given the environment of the user
 */
export const LaunchEnvironment: NodeJS.ProcessEnv = {...process.env}

//The commands of the migrations (MIGRATION_GENERATE, MIGRATION_RUN…) are given to the applications of the projects, not
//to the tool, an application of lakutata too: the tool run by a script of an application started by a migration command
//(lakutata clean in its build) does its own command; the commands it runs are still given them (LaunchEnvironment)
for (const name of Object.keys(process.env)) if (name.toUpperCase().startsWith('MIGRATION_')) delete process.env[name]
