<template>
  <div>
    <p><a href="/">Home</a> <a href="/about">About</a></p>
    <h1>Home</h1>
    <button @click="state.count++">count is: {{ state.count }}</button>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
const state = reactive({ count: 0 })
</script>

<style scoped>
div {
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
