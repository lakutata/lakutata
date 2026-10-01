import {Application} from '@lakutata/core'
import {Logger} from '@lakutata/logger'
import {Entrypoint} from '@lakutata/entrypoint'

//The applications of the lakutata package log with its Logger component and dispatch with its Entrypoint component
Application.preset({
    components: {
        log: {class: Logger},
        entrypoint: {class: Entrypoint}
    },
    bootstrap: ['log']
})

export * from '@lakutata/core'
export {Time} from '@lakutata/utils/time'
