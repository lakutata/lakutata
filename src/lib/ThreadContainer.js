if (require.resolve('ts-node')) require('ts-node').register()
const {Application, Logger} = require('../Lakutata')
const {workerData} = require('worker_threads')

const configurableProperties = workerData.configurableProperties
const moduleFilename = workerData.moduleId
const className = workerData.className
const ThreadTaskClassConstructor = require(moduleFilename)[className]

let app = null

async function getApp() {
    if (!app) {
        app = await Application.run({
            id: `${className}.thread`,
            name: `${className}-${process.env.appName}`,
            timezone: process.env.TZ,
            components: {
                // log: {
                //     class: Logger,
                //     provider: subProcessLoggerProviderProxy
                // }
            },
            entries: {
                [ThreadTaskClassConstructor.name]: {
                    class: ThreadTaskClassConstructor,
                    ...configurableProperties
                }
            },
            bootstrap: [ThreadTaskClassConstructor.name]
        })
    }
    return app
}

module.exports = async (inp) => {
    return await (await (await getApp()).get(ThreadTaskClassConstructor.name)).run(inp)
}
