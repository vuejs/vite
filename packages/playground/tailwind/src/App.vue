<template>
  <div>
    <h1>Tailwind app</h1>
    {{ foo }}
  </div>
  <router-view />
</template>

<script setup lang="ts">
  import { ref } from 'vue';
  const foo = ref(42);
</script>