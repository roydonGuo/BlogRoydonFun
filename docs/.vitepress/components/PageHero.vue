<template>
  <header class="page-hero" :data-decoration="decoration">
    <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
    <h1>{{ title }}</h1>
    <p v-if="description">{{ description }}</p>
  </header>
</template>

<script setup lang="ts">
interface Props {
  eyebrow?: string
  title: string
  description?: string
  decoration?: string
}

withDefaults(defineProps<Props>(), {
  decoration: '</>',
})
</script>

<style scoped>
.page-hero {
  position: relative;
  overflow: hidden;
  margin: 1rem 0;
  padding: 1.25rem 28px;
  text-align: center;
  border-radius: 24px;
  background:
    radial-gradient(circle at 15% 20%, rgba(36, 69, 235, 0.06), transparent 26%),
    radial-gradient(circle at 85% 70%, rgba(108, 140, 255, 0.1), transparent 30%);
}

.page-hero::after {
  content: attr(data-decoration);
  position: absolute;
  right: 4%;
  bottom: -24px;
  color: var(--vp-c-brand-1);
  font: 900 136px/1 monospace;
  opacity: 0.355;
  transform: rotate(-8deg);
}

.eyebrow {
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.page-hero h1 {
  margin: 10px 0;
  border: 0;
  font-size: clamp(28px, 5vw, 40px);
  line-height: 1.2;
  background: linear-gradient(120deg, #2445eb 25%, #7794ff);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.page-hero p {
  margin: 0 auto;
  max-width: 620px;
  color: var(--vp-c-text-2);
  line-height: 1.8;
  font-size: 13px;
}

@media (max-width: 700px) {
  .page-hero {
    padding: 34px 18px;
  }
}
</style>
