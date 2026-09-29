<script setup lang="ts">
/**
 * The results of the API: {errno, errMsg, data}
 */
type APIResult<T> = {
    errno: string | null
    errMsg: string | null
    data: T
}

const message = ref<string>('…')

//Called from the browser: on the server, /api is not the one of Nitro
onMounted(async (): Promise<void> => {
    try {
        const result: APIResult<{ message: string }> = await $fetch('/api/example', {query: {name: '{$APP_NAME}'}})
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
