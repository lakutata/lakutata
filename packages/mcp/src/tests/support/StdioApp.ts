import {Application} from '@lakutata/core'
import {buildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import {stdioMCPEntrypoint} from '../../exports/MCP.js'
import {DeviceController, ToolController} from './Tools.js'

//The entrypoint is a default component of the lakutata package, not of the core
Application.preset({components: {entrypoint: {class: Entrypoint}}})

/**
 * An application served to an MCP client over its standard input and output
 */
Application
    .run({
        id: 'mcp.stdio.app',
        name: 'MCPStdio',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [DeviceController, ToolController],
                mcp: stdioMCPEntrypoint({serverVersion: '3.0.0'})
            })
        },
        bootstrap: ['entrypoint']
    })
    .onDone((): void => void process.stderr.write('[done]\n'))
