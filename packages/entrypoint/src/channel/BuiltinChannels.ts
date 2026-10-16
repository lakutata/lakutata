import type {ActionPattern} from '@lakutata/core'
import {getObjectPropertyPaths, uniqueArray} from '@lakutata/utils'
import {ChannelDefinition, ChannelEntry, ChannelMatch, ChannelMatcher, defineChannel} from './Channel.js'
import {PatternManager} from '../lib/pattern/PatternManager.js'
import {flattenPattern, flattenSubject} from '../lib/pattern/FlattenPattern.js'
import {stringifyPattern} from '../lib/StringifyPattern.js'
import {prefixCommand, prefixPattern, prefixRoute} from '../lib/Prefix.js'
import {ContextType, type BaseContext} from '../context/BaseContext.js'
import type {HTTPContext} from '../context/HTTPContext.js'
import type {CLIContext} from '../context/CLIContext.js'
import type {ServiceContext} from '../context/ServiceContext.js'
import type {ScheduleContext} from '../context/ScheduleContext.js'
import {ControllerActionNotFoundException} from '../exceptions/ControllerActionNotFoundException.js'
import {unsetValue} from '../lib/UnsetValue.js'

/**
 * A lookup by exact key, falling back to the glob patterns
 * @param entries
 * @param key
 * @param subject
 */
function exactMatcher(entries: ChannelEntry[], key: (pattern: ActionPattern) => string, subject: (context: BaseContext) => ActionPattern): ChannelMatcher {
    const exact: Map<string, ChannelEntry> = new Map()
    const patterns: PatternManager = new PatternManager()
    for (const entry of entries) {
        exact.set(key(entry.details.pattern), entry)
        patterns.add(entry.details.pattern, entry)
    }
    return {
        match: (context: BaseContext): ChannelMatch | undefined => {
            const pattern: ActionPattern = subject(context)
            const entry: ChannelEntry | null = exact.get(key(pattern)) ?? patterns.find(pattern)
            return entry ? {entry: entry} : undefined
        }
    }
}

/**
 * The key of an HTTP action
 * @param pattern
 */
function httpKey(pattern: ActionPattern): string {
    return `${pattern.method}\u0000${pattern.route}`
}

/**
 * The HTTP channel, addressed by route and method
 */
export const HTTPChannel: ChannelDefinition = defineChannel({
    name: 'http',
    kind: 'request',
    contextType: ContextType.HTTP,
    identify: (pattern: ActionPattern): string => pattern.route,
    describe: (pattern: ActionPattern): Record<string, unknown> => ({route: pattern.route}),
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => prefix.route === undefined ? undefined : {...pattern, route: prefixRoute(prefix.route, pattern.route)},
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => exactMatcher(entries, httpKey, (context: BaseContext): ActionPattern => ({
        route: (context as HTTPContext).route,
        method: (context as HTTPContext).method
    })),
    notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('Route \'{route}\' not found', context)
})

/**
 * The CLI channel, addressed by command
 */
export const CLIChannel: ChannelDefinition = defineChannel({
    name: 'cli',
    kind: 'request',
    contextType: ContextType.CLI,
    identify: (pattern: ActionPattern): string => pattern.command,
    describe: (pattern: ActionPattern): Record<string, unknown> => ({command: pattern.command}),
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => prefix.command === undefined ? undefined : {command: prefixCommand(prefix.command, pattern.command)},
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => exactMatcher(entries, (pattern: ActionPattern): string => pattern.command, (context: BaseContext): ActionPattern => ({command: (context as CLIContext).command})),
    notFound: (): Error => new ControllerActionNotFoundException('Command not found')
})

/**
 * The service channel, addressed by pattern
 */
export const ServiceChannel: ChannelDefinition = defineChannel({
    name: 'service',
    kind: 'request',
    contextType: ContextType.SERVICE,
    identify: (pattern: ActionPattern): string => stringifyPattern(pattern),
    describe: (pattern: ActionPattern): Record<string, unknown> => ({pattern: pattern}),
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => prefix.pattern === undefined ? undefined : prefixPattern(prefix.pattern, pattern),
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => {
        //The values of the nested objects are compared one by one: {res: {name: 'user'}} matches as {'res.name': 'user'}
        const patterns: PatternManager = new PatternManager()
        for (const entry of entries) patterns.add(flattenPattern(entry.details.pattern), entry)
        return {
            match: (context: BaseContext): ChannelMatch | undefined => {
                const entry: ChannelEntry | null = patterns.find(flattenSubject((context as ServiceContext).input))
                return entry ? {entry: entry} : undefined
            }
        }
    },
    //The keys of the pattern are not a part of the action input
    prepare: (entry: ChannelEntry, context: BaseContext): void => {
        const patternPaths: string[] = getObjectPropertyPaths(entry.details.pattern)
        patternPaths.forEach((path: string): unknown => unsetValue(context.data, path))
        const checkPatternPaths: string[] = uniqueArray(patternPaths
            .map((path: string): string => path.substring(0, path.lastIndexOf('.')))
            .filter((path: string): boolean => !!path))
        checkPatternPaths.forEach((path: string): void => {
            let target: ActionPattern = context.data
            path.split('.').forEach((key: string): unknown => target = target[key] ? target[key] : undefined)
            if (target && !Object.keys(target).length) unsetValue(context.data, path)
        })
    },
    notFound: (): Error => new ControllerActionNotFoundException('Controller action not found')
})

/**
 * The schedule channel: no external caller, each action is run by the timers of the schedule adapter.
 * The address of an action is its schedule, with the key telling apart the actions of a same schedule
 */
export const ScheduleChannel: ChannelDefinition = defineChannel({
    name: 'schedule',
    kind: 'trigger',
    contextType: ContextType.SCHEDULE,
    identify: (pattern: ActionPattern): string => `${pattern.schedule}#${pattern.key}`,
    describe: (pattern: ActionPattern): Record<string, unknown> => {
        const {key, ...schedule} = pattern
        void key
        return schedule
    },
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => ({
        //The runs are dispatched to their action: a context is matched by its schedule
        match: (context: BaseContext): ChannelMatch | undefined => {
            const entry: ChannelEntry | undefined = entries.find((candidate: ChannelEntry): boolean => candidate.details.pattern.schedule === (context as ScheduleContext).schedule)
            return entry ? {entry: entry} : undefined
        }
    }),
    notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('No action is scheduled {schedule}', {schedule: (context as ScheduleContext).schedule})
})
