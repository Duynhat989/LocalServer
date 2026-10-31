<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { VueFlow, useVueFlow, MarkerType, Handle, Position } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { api } from '../api';
import { confirmDialog } from '../composables/useDialog';
import { useAuth } from '../composables/useAuth';
import {
  createDefaultFlow,
  findKeywordPaths,
  formatPathsExpression,
  getActiveFilterId,
  setActiveFilterId,
  parseFlow,
  serializeFlow,
  wouldCreateCycle,
} from '../utils/keywordFlow';
import DeletableFlowEdge from './DeletableFlowEdge.vue';
import LoadingState from './LoadingState.vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'change', 'apply']);

const { token } = useAuth();
const view = ref('list'); // list | editor
const items = ref([]);
const activeId = ref(getActiveFilterId());
const listLoading = ref(false);
const saving = ref(false);
const editingId = ref(null);
const editingName = ref('');
const nodes = ref([]);
const edges = ref([]);
const selectedNodeId = ref(null);
const notice = ref('');
const noticeError = ref(false);
const newNameDraft = ref('');
let keywordSeq = 1;

const { onConnect, addEdges, project, vueFlowRef } = useVueFlow({ id: 'keyword-filter-flow' });

const paths = computed(() => findKeywordPaths(nodes.value, edges.value));
const expression = computed(() => formatPathsExpression(paths.value));
const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) || null);

function bumpKeywordSeq() {
  let max = 0;
  for (const n of nodes.value) {
    const m = /^(?:kw|ex)-(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  keywordSeq = max + 1;
}

function flash(message, isError = false, ms = 2800) {
  notice.value = message;
  noticeError.value = isError;
  if (message) {
    setTimeout(() => {
      if (notice.value === message) notice.value = '';
    }, ms);
  }
}

function withDeletableEdges(list) {
  return (list || []).map((e) => ({
    ...e,
    type: 'deletable',
    markerEnd: e.markerEnd || MarkerType.ArrowClosed,
    style: e.style || { stroke: '#e85a0c', strokeWidth: 2 },
  }));
}

function cloneFlow(nodesIn, edgesIn) {
  const flow = parseFlow(serializeFlow(nodesIn || [], edgesIn || []));
  return {
    nodes: flow.nodes,
    edges: withDeletableEdges(flow.edges),
  };
}

function emitActiveFilter() {
  const active = items.value.find((i) => Number(i.id) === Number(activeId.value));
  const nextPaths = active
    ? findKeywordPaths(active.nodes || [], active.edges || [])
    : [];
  const payload = {
    paths: nextPaths,
    expression: formatPathsExpression(nextPaths),
    activeId: activeId.value,
    name: active?.name || '',
  };
  emit('change', payload);
  emit('apply', payload);
}

async function refreshLibrary() {
  listLoading.value = true;
  try {
    const data = await api('/api/filters', { token: token.value });
    items.value = (data.filters || []).map((item) => ({
      ...item,
      updatedAt: item.updated_at || item.updatedAt || null,
    }));
    if (
      activeId.value != null &&
      !items.value.some((i) => Number(i.id) === Number(activeId.value))
    ) {
      activeId.value = setActiveFilterId(null);
    }
  } catch (err) {
    flash(err.message || 'Không tải được danh sách bộ lọc', true);
    items.value = [];
  } finally {
    listLoading.value = false;
  }
}

async function openList(message = '') {
  view.value = 'list';
  editingId.value = null;
  selectedNodeId.value = null;
  nodes.value = [];
  edges.value = [];
  await refreshLibrary();
  if (message) flash(message, false, 3200);
  else if (!noticeError.value) notice.value = '';
}

function openEditor(item) {
  const flow = cloneFlow(item.nodes, item.edges);
  editingId.value = item.id;
  editingName.value = item.name || 'Bộ lọc';
  nodes.value = flow.nodes;
  edges.value = flow.edges;
  bumpKeywordSeq();
  selectedNodeId.value = null;
  view.value = 'editor';
  notice.value = '';
}

async function createNewFilter() {
  const name = (newNameDraft.value.trim() || `Bộ lọc ${items.value.length + 1}`).slice(0, 80);
  const flow = createDefaultFlow();
  saving.value = true;
  try {
    const data = await api('/api/filters', {
      method: 'POST',
      token: token.value,
      body: {
        name,
        nodes: flow.nodes,
        edges: flow.edges,
      },
    });
    const item = {
      ...data.filter,
      updatedAt: data.filter?.updated_at || null,
    };
    items.value = [item, ...items.value.filter((i) => i.id !== item.id)];
    newNameDraft.value = '';
    openEditor(item);
  } catch (err) {
    flash(err.message || 'Không tạo được bộ lọc', true);
  } finally {
    saving.value = false;
  }
}

function applyFilter(item) {
  activeId.value = setActiveFilterId(item.id);
  emitActiveFilter();
  flash(`Đã áp dụng “${item.name}”`);
}

function clearActiveFilter() {
  activeId.value = setActiveFilterId(null);
  emitActiveFilter();
  flash('Đã bỏ lọc từ khóa');
}

async function deleteFilter(item) {
  const ok = await confirmDialog({
    title: 'Xóa bộ lọc',
    message: `Xóa bộ lọc “${item.name}”?`,
    confirmText: 'Xóa',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/filters/${item.id}`, {
      method: 'DELETE',
      token: token.value,
    });
    items.value = items.value.filter((i) => i.id !== item.id);
    if (Number(activeId.value) === Number(item.id)) {
      activeId.value = setActiveFilterId(null);
      emitActiveFilter();
    }
    flash('Đã xóa bộ lọc');
  } catch (err) {
    flash(err.message || 'Không xóa được bộ lọc', true);
  }
}

function formatUpdated(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function pathPreview(item) {
  const p = findKeywordPaths(item.nodes || [], item.edges || []);
  return formatPathsExpression(p) || 'Chưa có logic';
}

function onNodeClick({ node }) {
  selectedNodeId.value = node.id;
}

function onPaneClick() {
  selectedNodeId.value = null;
}

function updateNodeLabel(nodeId, value) {
  nodes.value = nodes.value.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, label: value } } : n
  );
}

function addFlowNode(type) {
  const id = `${type === 'exclude' ? 'ex' : 'kw'}-${keywordSeq++}`;
  let position = { x: 240, y: 140 + ((keywordSeq * 28) % 180) };
  try {
    if (vueFlowRef.value) {
      const bounds = vueFlowRef.value.getBoundingClientRect();
      const projected = project({ x: bounds.width / 2, y: bounds.height / 2 });
      position = { x: projected.x - 70, y: projected.y - 24 };
    }
  } catch (_) {
    /* keep fallback */
  }
  nodes.value = [
    ...nodes.value,
    {
      id,
      type,
      position,
      data: { label: '' },
      deletable: true,
    },
  ];
  selectedNodeId.value = id;
  nextTick(() => {
    const input = document.querySelector(`[data-kw-input="${id}"]`);
    if (input) input.focus();
  });
}

function addKeywordNode() {
  addFlowNode('keyword');
}

function addExcludeNode() {
  addFlowNode('exclude');
}

function deleteSelected() {
  const node = selectedNode.value;
  if (!node) return;
  if (node.type !== 'keyword' && node.type !== 'exclude') {
    flash('Không thể xóa START/END', true);
    return;
  }
  const id = node.id;
  nodes.value = nodes.value.filter((n) => n.id !== id);
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id);
  selectedNodeId.value = null;
}

function deleteSelectedEdges() {
  const before = edges.value.length;
  edges.value = edges.value.filter((e) => !e.selected);
  if (edges.value.length === before) {
    flash('Bấm nút × trên đường nối, hoặc chọn cạnh rồi xóa', true);
  }
}

function removeEdgeById(edgeId) {
  edges.value = edges.value.filter((e) => e.id !== edgeId);
}

onConnect((params) => {
  if (params.source === params.target) {
    flash('Không nối một node vào chính nó', true);
    return;
  }
  if (params.target === 'start') {
    flash('Không thể nối vào START', true);
    return;
  }
  if (params.source === 'end') {
    flash('Không thể nối từ END', true);
    return;
  }
  if (wouldCreateCycle(params.source, params.target, edges.value)) {
    flash('Kết nối này tạo vòng lặp', true);
    return;
  }
  if (edges.value.some((e) => e.source === params.source && e.target === params.target)) {
    flash('Đã có kết nối này', true);
    return;
  }

  addEdges(
    withDeletableEdges([
      {
        ...params,
        id: `e-${params.source}-${params.target}-${Date.now()}`,
        markerEnd: MarkerType.ArrowClosed,
        style: { stroke: '#e85a0c', strokeWidth: 2 },
      },
    ])
  );
});

async function saveCurrentFilter({ apply = false, closeAfter = false } = {}) {
  if (!editingId.value) {
    flash('Không tìm thấy bộ lọc đang sửa', true);
    return;
  }

  const name = editingName.value.trim() || 'Bộ lọc';
  let nextNodes = nodes.value;
  let nextEdges = edges.value;

  const emptyIds = new Set(
    nextNodes
      .filter((n) => (n.type === 'keyword' || n.type === 'exclude') && !String(n.data?.label || '').trim())
      .map((n) => n.id)
  );
  if (emptyIds.size) {
    nextNodes = nextNodes.filter((n) => !emptyIds.has(n.id));
    nextEdges = nextEdges.filter((e) => !emptyIds.has(e.source) && !emptyIds.has(e.target));
    nodes.value = nextNodes;
    edges.value = nextEdges;
  }

  const flow = cloneFlow(nextNodes, nextEdges);
  saving.value = true;
  try {
    const data = await api(`/api/filters/${editingId.value}`, {
      method: 'PATCH',
      token: token.value,
      body: {
        name,
        nodes: flow.nodes,
        edges: flow.edges,
      },
    });
    const saved = {
      ...data.filter,
      updatedAt: data.filter?.updated_at || null,
    };
    items.value = items.value.map((i) => (Number(i.id) === Number(saved.id) ? saved : i));

    if (apply) {
      activeId.value = setActiveFilterId(saved.id);
      emitActiveFilter();
    }

    const msg = apply ? `Đã lưu & áp dụng “${name}”` : `Đã lưu “${name}” vào database`;
    if (closeAfter) {
      flash(msg);
      view.value = 'list';
      editingId.value = null;
      emit('close');
    } else {
      await openList(msg);
    }
  } catch (err) {
    flash(err.message || 'Không lưu được bộ lọc', true);
  } finally {
    saving.value = false;
  }
}

function resetEditorCanvas() {
  const flow = createDefaultFlow();
  nodes.value = flow.nodes;
  edges.value = flow.edges;
  keywordSeq = 1;
  selectedNodeId.value = null;
  flash('Đã reset canvas');
}

function close() {
  emit('close');
}

watch(
  () => props.open,
  async (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      activeId.value = getActiveFilterId();
      await openList();
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay fade-in keyword-flow-overlay" @click.self="close">
      <div
        class="modal-card modal-card--flow slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyword-flow-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="keyword-flow-title">
              {{ view === 'list' ? 'Chọn bộ lọc từ khóa' : 'Chỉnh sửa bộ lọc' }}
            </h3>
            <p v-if="view === 'list'">
              Bộ lọc lưu trên database · Chọn để áp dụng, hoặc tạo mới
            </p>
            <p v-else>Cùng nhánh = AND · Song song = OR · Sửa từ khóa ngay trên node</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="close">×</button>
        </div>

        <div v-if="notice" class="alert" :class="noticeError ? 'alert--error' : 'alert--ok'">
          {{ notice }}
        </div>

        <template v-if="view === 'list'">
          <div class="filter-create-row">
            <input
              v-model="newNameDraft"
              type="text"
              placeholder="Tên bộ lọc mới…"
              :disabled="saving"
              @keydown.enter.prevent="createNewFilter"
            />
            <button
              class="btn btn--primary btn--inline"
              type="button"
              :disabled="saving"
              @click="createNewFilter"
            >
              <span v-if="saving" class="spinner spinner--sm" aria-hidden="true" />
              {{ saving ? 'Đang tạo…' : '+ Tạo mới' }}
            </button>
          </div>

          <div class="filter-list-actions">
            <button
              class="btn btn--ghost btn--inline"
              type="button"
              :disabled="activeId == null"
              @click="clearActiveFilter"
            >
              Bỏ áp dụng
            </button>
          </div>

          <LoadingState v-if="listLoading" compact label="Đang tải danh sách…" />
          <div v-else-if="items.length" class="filter-list">
            <div
              v-for="item in items"
              :key="item.id"
              class="filter-item"
              :class="{ 'is-active': Number(item.id) === Number(activeId) }"
            >
              <button type="button" class="filter-item-main" @click="applyFilter(item)">
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ pathPreview(item) }}</span>
                <span class="muted filter-item-meta">
                  Cập nhật {{ formatUpdated(item.updatedAt || item.updated_at) }}
                </span>
              </button>
              <div class="filter-item-actions">
                <button
                  class="btn btn--ghost btn--tiny"
                  type="button"
                  @click.stop="openEditor(item)"
                >
                  Sửa
                </button>
                <button
                  class="btn btn--ghost btn--tiny"
                  type="button"
                  @click.stop="deleteFilter(item)"
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>
          <p v-else class="empty">Chưa có bộ lọc nào. Tạo mới để bắt đầu.</p>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="close">Đóng</button>
          </div>
        </template>

        <template v-else>
          <div class="flow-edit-row">
            <label for="filter-name">Tên bộ lọc</label>
            <input id="filter-name" v-model="editingName" type="text" placeholder="Tên bộ lọc…" />
            <button class="btn btn--ghost btn--inline" type="button" @click="openList()">
              ← Danh sách
            </button>
          </div>

          <div class="flow-toolbar">
            <button class="btn btn--primary btn--inline" type="button" @click="addKeywordNode">
              + Thêm từ khóa
            </button>
            <button class="btn btn--ghost btn--inline" type="button" @click="addExcludeNode">
              + Loại trừ
            </button>
            <button
              class="btn btn--ghost btn--inline"
              type="button"
              :disabled="!selectedNode || (selectedNode.type !== 'keyword' && selectedNode.type !== 'exclude')"
              @click="deleteSelected"
            >
              Xóa node
            </button>
            <button class="btn btn--ghost btn--inline" type="button" @click="deleteSelectedEdges">
              Xóa kết nối
            </button>
            <button class="btn btn--ghost btn--inline" type="button" @click="resetEditorCanvas">
              Reset canvas
            </button>
          </div>

          <div class="flow-canvas-wrap">
            <VueFlow
              id="keyword-filter-flow"
              v-model:nodes="nodes"
              v-model:edges="edges"
              :default-viewport="{ zoom: 1, x: 0, y: 0 }"
              :min-zoom="0.4"
              :max-zoom="2"
              fit-view-on-init
              :delete-key-code="['Backspace', 'Delete']"
              class="keyword-flow-canvas"
              @node-click="onNodeClick"
              @pane-click="onPaneClick"
            >
              <Background :gap="18" pattern-color="#f0e4d8" />
              <Controls />
              <MiniMap pannable zoomable />

              <template #edge-deletable="edgeProps">
                <DeletableFlowEdge v-bind="edgeProps" @remove="removeEdgeById" />
              </template>

              <template #node-start="nodeProps">
                <div class="flow-node flow-node--start">
                  <strong>{{ nodeProps.data.label || 'START' }}</strong>
                  <Handle id="out" type="source" :position="Position.Right" />
                </div>
              </template>

              <template #node-end="nodeProps">
                <div class="flow-node flow-node--end">
                  <Handle id="in" type="target" :position="Position.Left" />
                  <strong>{{ nodeProps.data.label || 'END' }}</strong>
                </div>
              </template>

              <template #node-keyword="nodeProps">
                <div
                  class="flow-node flow-node--keyword"
                  :class="{ 'is-selected': nodeProps.selected }"
                >
                  <Handle id="in" type="target" :position="Position.Left" />
                  <input
                    class="flow-node-input nodrag nopan"
                    :data-kw-input="nodeProps.id"
                    :value="nodeProps.data.label"
                    type="text"
                    placeholder="Nhập từ khóa…"
                    @mousedown.stop
                    @click.stop
                    @input="updateNodeLabel(nodeProps.id, $event.target.value)"
                  />
                  <Handle id="out" type="source" :position="Position.Right" />
                </div>
              </template>

              <template #node-exclude="nodeProps">
                <div
                  class="flow-node flow-node--exclude"
                  :class="{ 'is-selected': nodeProps.selected }"
                >
                  <Handle id="in" type="target" :position="Position.Left" />
                  <span class="flow-node-tag">Loại trừ</span>
                  <input
                    class="flow-node-input nodrag nopan"
                    :data-kw-input="nodeProps.id"
                    :value="nodeProps.data.label"
                    type="text"
                    placeholder="Từ khóa loại trừ…"
                    @mousedown.stop
                    @click.stop
                    @input="updateNodeLabel(nodeProps.id, $event.target.value)"
                  />
                  <Handle id="out" type="source" :position="Position.Right" />
                </div>
              </template>
            </VueFlow>
          </div>

          <div class="flow-logic">
            <strong>Logic lọc</strong>
            <p v-if="expression" class="flow-expression">{{ expression }}</p>
            <p v-else class="muted">
              Chưa có đường START → END. Ví dụ: START → Chung cư → Loại trừ ct04 → END
            </p>
            <p class="muted flow-hint">
              {{ paths.length }} nhánh hợp lệ · Lưu vào database khi bấm Lưu
            </p>
          </div>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="openList()">Hủy</button>
            <button
              class="btn btn--ghost btn--inline"
              type="button"
              :disabled="saving"
              @click="saveCurrentFilter({ apply: false })"
            >
              <span v-if="saving" class="spinner spinner--sm" aria-hidden="true" />
              {{ saving ? 'Đang lưu…' : 'Lưu vào DB' }}
            </button>
            <button
              class="btn btn--primary btn--inline"
              type="button"
              :disabled="saving"
              @click="saveCurrentFilter({ apply: true, closeAfter: true })"
            >
              <span v-if="saving" class="spinner spinner--sm" aria-hidden="true" />
              {{ saving ? 'Đang lưu…' : 'Lưu & áp dụng' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
