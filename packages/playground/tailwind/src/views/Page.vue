<template>
    <div>
        <h1 id="pagetitle" class="text-[rgb(11,22,33)] text-2xl">|Page title|</h1>
        <div @click="val = val+1">{{ val }}</div>
        <div class="bg-red-100 inline-block h-24 px-8 mb-8 text-[#888888]">Tailwind style</div>
        <HelloWorld />
    </div>
</template>

<script lang="ts">

import { defineComponent, ref } from 'vue';
import HelloWorld from '../components/HelloWorld.vue';

export default defineComponent({
    components: { HelloWorld },
    setup() {
        const val = ref(0);

        return {
            val
        }
    }
});

</script>
