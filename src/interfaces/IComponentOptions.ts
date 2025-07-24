import {Component} from '../lib/core/Component.js'

export interface IComponentOptions {
    class: typeof Component

    [prop: string]: any
}