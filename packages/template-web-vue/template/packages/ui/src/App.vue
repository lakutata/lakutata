<script setup lang="ts">
import {onMounted, ref} from 'vue'

/**
 * The results of the API: {errno, errMsg, data}
 */
type APIResult<T> = {
    errno: string | null
    errMsg: string | null
    data: T
}

const message = ref<string>('…')

onMounted(async (): Promise<void> => {
    try {
        const result: APIResult<{ message: string }> = await (await fetch('/api/example?name={$APP_NAME}')).json()
        message.value = result.errno ? `${result.errno}: ${result.errMsg}` : result.data.message
    } catch (error) {
        message.value = (error as Error).message
    }
})
</script>

<template>
    <main>
        <h1>{$APP_NAME}</h1>
        <p>{{ message }}</p>
    </main>
</template>
