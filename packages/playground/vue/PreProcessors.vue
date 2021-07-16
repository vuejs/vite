<template lang="pug">
h2.pre-processors Pre-Processors
p.pug
  | This is rendered from &lt;template lang="pug"&gt;
  | and styled with &lt;style lang="sass"&gt;. It should be megenta.
p.pug-less
  | This is rendered from &lt;template lang="pug"&gt;
  | and styled with &lt;style lang="less"&gt;. It should be green.
p.pug-stylus
  | This is rendered from &lt;template lang="pug"&gt;
  | and styled with &lt;style lang="stylus"&gt;. It should be orange.
SlotComponent
  template(v-slot:test-slot)
    div.pug-slot slot content
</template>

<script setup>
function SlotComponent(_, { slots }) {
  return slots['test-slot']()
}
</script>

<style lang="scss">
$color: magenta;

.pug {
  color: $color;
}
</style>

<style lang="less" scoped>
@color: green;

.pug-less {
  color: @color;
}
</style>

<style lang="stylus">
color = orange

.pug-stylus
  color: color
</style>
