<script setup>
const LOADING_GIF_URL =
  'https://cdn.pixabay.com/animation/2025/11/11/02/19/02-19-36-889_512.gif';

defineProps({
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v),
  },
});
</script>

<template>
  <img
    :src="LOADING_GIF_URL"
    class="loading-gif"
    :class="`loading-gif--${size}`"
    alt=""
    aria-hidden="true"
    decoding="async"
  />
</template>
