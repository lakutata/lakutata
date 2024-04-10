interface ProjectTypeBranch {
    [type: string]: {
        branch: string
    }
}

export const ProjectTypeConfig: ProjectTypeBranch = {
    plain: {
        branch: 'main'
    },
    cli: {
        branch: 'cli'
    },
    api: {
        branch: 'api'
    },
    electron: {
        branch: 'electron'
    }
}
