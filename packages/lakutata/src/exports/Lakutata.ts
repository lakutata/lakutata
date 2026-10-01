import 'reflect-metadata'
import {SetDefaultComponent} from '@lakutata/core/internal'
import {Logger} from '@lakutata/logger'
import {Entrypoint} from '@lakutata/entrypoint'

//The applications of the lakutata package log with its Logger component and dispatch with its Entrypoint component
SetDefaultComponent('log', {class: Logger})
SetDefaultComponent('entrypoint', {class: Entrypoint})

export * from '@lakutata/core'
export {Time} from '@lakutata/utils/time'
