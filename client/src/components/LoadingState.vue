<script setup>
defineProps({
  label: {
    type: String,
    default: '',
  },
  compact: {
    type: Boolean,
    default: false,
  },
  overlay: {
    type: Boolean,
    default: false,
  },
  /** Phủ toàn màn hình — chặn click filter, nav con, bảng… */
  blockLayout: {
    type: Boolean,
    default: false,
  },
});
</script>

<template>
  <Teleport v-if="blockLayout" to="body">
    <div
      class="loading-state loading-state--layout-block"
      role="status"
      aria-live="polite"
      :aria-label="label || 'Đang tải'"
    >
      <span class="spinner spinner--lg" aria-hidden="true" />
      <span v-if="label" class="loading-state__label">{{ label }}</span>
    </div>
  </Teleport>
  <div
    v-else
    class="loading-state"
    :class="{
      'loading-state--compact': compact,
      'loading-state--overlay': overlay,
    }"
    role="status"
    aria-live="polite"
    :aria-label="label || 'Đang tải'"
  >
    <span class="spinner spinner--lg" aria-hidden="true" />
    <span v-if="label" class="loading-state__label">{{ label }}</span>
  </div>
</template>
