import 'reflect-metadata'
import {SetDefaultComponent} from '@lakutata/core/internal'
import {Logger} from '@lakutata/logger'

//The applications of the lakutata package log with its Logger component
SetDefaultComponent('log', {class: Logger})

export * from '@lakutata/core'
export {Time} from '@lakutata/utils'
