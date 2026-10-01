import {Application} from '@lakutata/core'
import {BuildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import {StdioMCPEntrypoint} from '../../exports/MCP.js'
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
            entrypoint: BuildEntrypoints({
                controllers: [DeviceController, ToolController],
                mcp: StdioMCPEntrypoint({serverVersion: '3.0.0'})
            })
        },
        bootstrap: ['entrypoint']
    })
    .onDone((): void => void process.stderr.write('[done]\n'))
