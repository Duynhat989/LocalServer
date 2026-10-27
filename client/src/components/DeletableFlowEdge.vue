<script setup>
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core';

const props = defineProps({
  id: String,
  sourceX: Number,
  sourceY: Number,
  targetX: Number,
  targetY: Number,
  sourcePosition: String,
  targetPosition: String,
  markerEnd: [String, Object],
  style: Object,
  selected: Boolean,
});

const emit = defineEmits(['remove']);

const path = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  })
);

const edgePath = computed(() => path.value[0]);
const labelX = computed(() => path.value[1]);
const labelY = computed(() => path.value[2]);

function onRemove(event) {
  event.stopPropagation();
  event.preventDefault();
  emit('remove', props.id);
}
</script>

<template>
  <BaseEdge
    :id="id"
    :path="edgePath"
    :marker-end="markerEnd"
    :style="{
      stroke: selected ? '#c2410c' : '#e85a0c',
      strokeWidth: selected ? 2.8 : 2,
      ...style,
    }"
  />
  <EdgeLabelRenderer>
    <div
      class="edge-delete-wrap nodrag nopan"
      :style="{
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all',
      }"
    >
      <button
        class="edge-delete-btn"
        type="button"
        title="Xóa kết nối"
        aria-label="Xóa kết nối"
        @click="onRemove"
        @mousedown.stop
      >
        ×
      </button>
    </div>
  </EdgeLabelRenderer>
</template>
