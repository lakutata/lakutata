import {ICType} from './interfaces/ICType.js'
import {TypeSpecWithAlignment} from './types/TypeSpecWithAlignment.js'
import * as koffi from 'koffi'

export function Union(name: string, def: Record<string, TypeSpecWithAlignment>): ICType
export function Union(def: Record<string, TypeSpecWithAlignment>): ICType
export function Union(a: any, b?: any): ICType {
    return koffi.union(a, b)
}
