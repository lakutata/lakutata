/**
 * The response of an action of the main process
 */
type ServiceResponse<T> = {
    success: boolean
    error: { message?: string, errno?: string } | null
    payload: T
}

declare global {
    interface Window {
        /**
         * Given by the preload script of the window of the application
         */
        lakutata?: {
            invoke<T>(data: Record<string, unknown>): Promise<ServiceResponse<T>>
        }
    }
}

/**
 * Invoke an action of the main process (a @ServiceAction of its controllers)
 * @param cmd
 * @param input
 */
export async function Invoke<T>(cmd: string, input: Record<string, unknown> = {}): Promise<T> {
    if (!window.lakutata) throw new Error('The actions are invoked in the window of the application (npm run dev)')
    const response: ServiceResponse<T> = await window.lakutata.invoke<T>({...input, cmd: cmd})
    if (!response.success) throw Object.assign(new Error(response.error?.message ?? 'The action failed'), response.error)
    return response.payload
}
