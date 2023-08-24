if (require.resolve('ts-node')) require('ts-node').register()
require('../Lakutata')
const {workerData} = require('worker_threads')
const {Application} = require('./Application')
const {Logger} = require('./components/Logger')

const configurableProperties = workerData.configurableProperties
const moduleFilename = workerData.moduleId
const className = workerData.className
const ThreadTaskClassConstructor = require(moduleFilename)[className]

Application.run({
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
}).then(() => {
    console.log('OKKKKK')
}).catch(e => {
    console.log('ERRRRRR', e)
})
//     .then(() => process.send!(['ready']))
// .catch(e => process.send!(['__$psError', e]))
