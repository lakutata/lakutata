import diagnosticsChannel from 'node:diagnostics_channel'
import type * as FastifyAdapter from '../../exports/FastifyAdapter.js'

/**
 * Why a test serving with Fastify is skipped: Fastify 5 needs diagnostics_channel.tracingChannel (Node.js 18.19, 19.9,
 * 20 and later), without which it does not load
 */
export const NO_FASTIFY: string | false = typeof (diagnosticsChannel as { tracingChannel?: unknown }).tracingChannel === 'function' ? false : 'Fastify 5 needs diagnostics_channel.tracingChannel (Node.js 18.19, 19.9, 20 or later)'

/**
 * The Fastify adapter, loaded where Fastify loads; an empty object elsewhere, where its tests are skipped
 */
export const FASTIFY: typeof FastifyAdapter = NO_FASTIFY ? {} as typeof FastifyAdapter : await import('../../exports/FastifyAdapter.js')
