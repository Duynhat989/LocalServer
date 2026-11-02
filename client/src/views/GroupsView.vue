<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Save } from '@lucide/vue';
import { api } from '../api';
import { confirmDialog } from '../composables/useDialog';
import { useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const PAGE_LIMIT_OPTIONS = [20, 50, 100, 200];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Chờ quét' },
  { value: 'active', label: 'Đang claim' },
  { value: 'paused', label: 'Tạm dừng' },
  { value: 'done', label: 'Xong' },
  { value: 'error', label: 'Lỗi' },
];

const { token, isStaff } = useAuth();
const groups = ref([]);
const total = ref(0);
const totalAll = ref(0);
const totals = ref({ posts: 0, phones: null });
const totalsPhonesLoading = ref(false);
const loading = ref(true);
const error = ref('');
const searchQuery = ref('');
const statusFilter = ref('');
const scannedFrom = ref('');
const scannedTo = ref('');
const actionMsg = ref('');
const actionError = ref('');
const busyId = ref(null);
const page = ref(1);
const pageLimit = ref(20);

const scanSettings = reactive({
  groupCooldownValue: 1,
  groupCooldownUnit: 'month',
  scanCutoffDate: '2023-01-01',
  duplicateStreakLimit: 5,
  claimTimeoutMinutes: 120,
  claimPollSeconds: 15,
});
const settingsBusy = ref(false);
const settingsMsg = ref('');
const settingsError = ref('');

const showCreateModal = ref(false);
const createForm = reactive({
  uid: '',
  name: '',
  link: '',
  status: 'pending',
  note: '',
});
const createError = ref('');
const createOk = ref('');
const createBusy = ref(false);

const showDetailModal = ref(false);
const detailGroup = ref(null);
const detailMsg = ref('');
const detailError = ref('');
const deletePostsBusy = ref(false);
const deleteGroupBusy = ref(false);

function statusLabel(value) {
  return STATUS_OPTIONS.find((s) => s.value === value)?.label || value || '—';
}

function claimLabel(group) {
  if (group?.status !== 'active') return '';
  return `Đang claim · ${group.claimedBy || '—'}`;
}

function statusDisplay(group) {
  return claimLabel(group) || statusLabel(group?.status);
}

function statusClass(value) {
  return `tag tag--status-${value || 'pending'}`;
}

function scannedAtMs(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

function formatScannedAt(value) {
  const ms = scannedAtMs(value);
  if (ms == null) return value == null || value === '' ? '—' : String(value);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function dayStartMs(dateOnly) {
  const ms = new Date(`${dateOnly}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dayEndMs(dateOnly) {
  const ms = new Date(`${dateOnly}T23:59:59.999`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatMs(value) {
  if (value == null || value === '') return '—';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function stopReasonLabel(value) {
  const map = {
    exhausted: 'Hết bài',
    cutoff: 'Chạm mốc thời gian',
    duplicate_streak: 'Trùng liên tiếp',
    error: 'Lỗi',
    manual: 'Thủ công',
    cancelled: 'Huỷ',
  };
  return map[value] || value || '—';
}

const hasListFilter = computed(
  () =>
    Boolean(String(searchQuery.value || '').trim()) ||
    Boolean(statusFilter.value) ||
    Boolean(scannedFrom.value) ||
    Boolean(scannedTo.value)
);

const totalPages = computed(() =>
  Math.max(1, Math.ceil((total.value || 0) / pageLimit.value) || 1)
);

const pageNumbers = computed(() => {
  const current = page.value;
  const last = totalPages.value;
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  let end = Math.min(last, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = [];
  for (let i = start; i <= end; i += 1) pages.push(i);
  return pages;
});

const rangeLabel = computed(() => {
  if (!total.value) return `0 nhóm · ${totals.value.posts} bài · ${totals.value.phones} SĐT`;
  const from = (page.value - 1) * pageLimit.value + 1;
  const to = Math.min(page.value * pageLimit.value, total.value);
  let text = `${from}–${to} / ${total.value} nhóm`;
  if (hasListFilter.value && totalAll.value > total.value) {
    text += ` · lọc từ ${totalAll.value}`;
  }
  text += ` · ${totals.value.posts} bài`;
  return text;
});

function goToPage(next) {
  const target = Math.min(Math.max(1, next), totalPages.value);
  if (target === page.value) return;
  page.value = target;
}

let loadSeq = 0;
let phoneLoadSeq = 0;
let searchDebounceTimer = null;

function buildGroupsQuery() {
  const params = new URLSearchParams();
  params.set('limit', String(pageLimit.value));
  params.set('offset', String((page.value - 1) * pageLimit.value));
  const q = String(searchQuery.value || '').trim();
  if (q) params.set('q', q);
  if (statusFilter.value) params.set('status', statusFilter.value);
  if (scannedFrom.value) params.set('scannedFrom', scannedFrom.value);
  if (scannedTo.value) params.set('scannedTo', scannedTo.value);
  return params.toString();
}

function scheduleLoadGroups(resetPage = false) {
  if (resetPage && page.value !== 1) {
    page.value = 1;
    return;
  }
  loadGroups();
}

async function loadGlobalPhonesTotal(parentSeq) {
  totalsPhonesLoading.value = true;
  try {
    const data = await api('/api/groups/stats/phones-total', { token: token.value });
    if (parentSeq !== phoneLoadSeq) return;
    totals.value = {
      ...totals.value,
      phones: Number(data.phoneCount) || 0,
    };
  } catch {
    if (parentSeq !== phoneLoadSeq) return;
    totals.value = { ...totals.value, phones: 0 };
  } finally {
    if (parentSeq === phoneLoadSeq) totalsPhonesLoading.value = false;
  }
}

async function loadPhoneCountsSequential() {
  const seq = ++phoneLoadSeq;
  totals.value = { ...totals.value, phones: null };
  totalsPhonesLoading.value = false;

  for (let i = 0; i < groups.value.length; i += 1) {
    if (seq !== phoneLoadSeq) return;
    const g = groups.value[i];
    if (!g?.uid) continue;

    groups.value[i] = { ...g, phoneLoading: true, phoneCount: null };

    try {
      const data = await api(
        `/api/groups/stats/phone?uid=${encodeURIComponent(g.uid)}`,
        { token: token.value }
      );
      if (seq !== phoneLoadSeq) return;
      const updated = {
        ...groups.value[i],
        phoneCount: Number(data.phoneCount) || 0,
        phoneLoading: false,
      };
      groups.value[i] = updated;
      if (detailGroup.value?.id === updated.id) detailGroup.value = { ...updated };
    } catch {
      if (seq !== phoneLoadSeq) return;
      const updated = {
        ...groups.value[i],
        phoneCount: 0,
        phoneLoading: false,
      };
      groups.value[i] = updated;
      if (detailGroup.value?.id === updated.id) detailGroup.value = { ...updated };
    }
  }

  if (seq === phoneLoadSeq) {
    loadGlobalPhonesTotal(seq);
  }
}

async function loadGroups() {
  const seq = ++loadSeq;
  phoneLoadSeq += 1;
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/api/groups?${buildGroupsQuery()}`, { token: token.value });
    if (seq !== loadSeq) return;

    groups.value = (data.groups || []).map((g) => ({
      ...g,
      phoneCount: g.phoneCount ?? null,
      phoneLoading: g.phoneCount == null,
    }));
    total.value = Number(data.total) || 0;
    totalAll.value = Number(data.totalAll) || total.value;
    totals.value = {
      posts: Number(data.totals?.posts) || 0,
      phones: data.totals?.phones != null ? Number(data.totals.phones) : null,
    };

    if (data.limit && PAGE_LIMIT_OPTIONS.includes(Number(data.limit))) {
      pageLimit.value = Number(data.limit);
    }

    const maxPage = Math.max(1, Math.ceil(total.value / pageLimit.value) || 1);
    if (page.value > maxPage) {
      page.value = maxPage;
      loading.value = false;
      await loadGroups();
      return;
    }

    loadPhoneCountsSequential();
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = err.message || 'Không tải được nhóm';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch([statusFilter, scannedFrom, scannedTo, pageLimit], () => {
  scheduleLoadGroups(true);
});

watch(page, () => {
  loadGroups();
});

watch(searchQuery, () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => scheduleLoadGroups(true), 350);
});

async function loadScanSettings() {
  settingsError.value = '';
  try {
    const data = await api('/api/settings/scan', { token: token.value });
    Object.assign(scanSettings, data.settings || {});
  } catch (err) {
    settingsError.value = err.message || 'Không tải được cài đặt quét';
  }
}

async function saveScanSettings() {
  settingsBusy.value = true;
  settingsMsg.value = '';
  settingsError.value = '';
  try {
    const data = await api('/api/settings/scan', {
      method: 'PATCH',
      token: token.value,
      body: { ...scanSettings },
    });
    Object.assign(scanSettings, data.settings || {});
    settingsMsg.value = 'Đã lưu cài đặt quét';
  } catch (err) {
    settingsError.value = err.message || 'Không lưu được cài đặt';
  } finally {
    settingsBusy.value = false;
  }
}

function openCreateModal() {
  createError.value = '';
  createOk.value = '';
  createForm.uid = '';
  createForm.name = '';
  createForm.link = '';
  createForm.status = 'pending';
  createForm.note = '';
  showCreateModal.value = true;
}

function closeCreateModal() {
  if (createBusy.value) return;
  showCreateModal.value = false;
}

async function onCreateGroup() {
  createError.value = '';
  createOk.value = '';
  createBusy.value = true;
  try {
    const data = await api('/api/groups', {
      method: 'POST',
      token: token.value,
      body: {
        uid: createForm.uid.trim(),
        name: createForm.name.trim(),
        link: createForm.link.trim(),
        status: createForm.status,
        note: createForm.note.trim(),
      },
    });
    await loadGroups();
    createOk.value = 'Đã thêm nhóm';
    setTimeout(() => {
      showCreateModal.value = false;
      createOk.value = '';
    }, 600);
  } catch (err) {
    createError.value = err.message || 'Không thêm được nhóm';
  } finally {
    createBusy.value = false;
  }
}

async function onStatusChange(group, event) {
  const next = event.target.value;
  if (!next || next === group.status) return;
  actionMsg.value = '';
  actionError.value = '';
  busyId.value = group.id;
  try {
    const data = await api(`/api/groups/${group.id}`, {
      method: 'PATCH',
      token: token.value,
      body: { status: next },
    });
    const updated = data.group;
    groups.value = groups.value.map((g) => (g.id === group.id ? updated : g));
    if (detailGroup.value?.id === group.id) {
      detailGroup.value = { ...detailGroup.value, ...updated };
    }
    actionMsg.value = `Đã đổi trạng thái → ${statusLabel(next)}`;
  } catch (err) {
    actionError.value = err.message || 'Không cập nhật được trạng thái';
    event.target.value = group.status;
  } finally {
    busyId.value = null;
  }
}

function openDetailModal(group) {
  detailMsg.value = '';
  detailError.value = '';
  detailGroup.value = { ...group };
  showDetailModal.value = true;
}

function closeDetailModal() {
  if (deletePostsBusy.value || deleteGroupBusy.value) return;
  showDetailModal.value = false;
  detailGroup.value = null;
  detailMsg.value = '';
  detailError.value = '';
}

async function onDeleteGroupPosts() {
  const group = detailGroup.value;
  if (!group?.uid) return;
  const count = Number(group.postCount) || 0;
  const ok = await confirmDialog({
    title: 'Xóa bài đăng của nhóm',
    message: `Xóa toàn bộ ${count} bài đăng của nhóm ${group.name || group.uid}?\nThao tác này không hoàn tác được.`,
    confirmText: 'Xóa',
    danger: true,
  });
  if (!ok) return;

  deletePostsBusy.value = true;
  detailMsg.value = '';
  detailError.value = '';
  try {
    const data = await api(`/api/posts/by-group/${encodeURIComponent(group.uid)}`, {
      method: 'DELETE',
      token: token.value,
    });
    const deleted = Number(data.deleted) || 0;
    detailGroup.value = {
      ...group,
      postCount: 0,
      phoneCount: 0,
    };
    groups.value = groups.value.map((g) =>
      g.id === group.id ? { ...g, postCount: 0, phoneCount: 0 } : g
    );
    totals.value = {
      posts: Math.max(0, (totals.value.posts || 0) - deleted),
      phones: Math.max(0, (totals.value.phones || 0) - (Number(group.phoneCount) || 0)),
    };
    detailMsg.value = `Đã xóa ${deleted} bài đăng của nhóm`;
    actionMsg.value = detailMsg.value;
  } catch (err) {
    detailError.value = err.message || 'Không xóa được bài đăng';
  } finally {
    deletePostsBusy.value = false;
  }
}

async function onDeleteGroup() {
  const group = detailGroup.value;
  if (!group?.id || deleteGroupBusy.value) return;
  const name = group.name || group.uid;
  const count = Number(group.postCount) || 0;
  const ok = await confirmDialog({
    title: 'Xóa nhóm',
    message:
      count > 0
        ? `Xóa nhóm ${name} và ${count} bài đăng của nhóm?\nThao tác này không hoàn tác được.`
        : `Xóa nhóm ${name}?\nThao tác này không hoàn tác được.`,
    confirmText: 'Xóa nhóm',
    danger: true,
  });
  if (!ok) return;

  deleteGroupBusy.value = true;
  detailMsg.value = '';
  detailError.value = '';
  try {
    await api(`/api/groups/${group.id}`, {
      method: 'DELETE',
      token: token.value,
    });
    deleteGroupBusy.value = false;
    closeDetailModal();
    await loadGroups();
    actionMsg.value = `Đã xóa nhóm ${name}`;
    actionError.value = '';
  } catch (err) {
    detailError.value = err.message || 'Không xóa được nhóm';
    deleteGroupBusy.value = false;
  }
}

watch([showCreateModal, showDetailModal], ([createOpen, detailOpen]) => {
  document.body.style.overflow = createOpen || detailOpen ? 'hidden' : '';
});

onMounted(async () => {
  await Promise.all([loadGroups(), loadScanSettings()]);
});
</script>

<template>
  <section class="users-panel">
    <div class="panel-head panel-head--actions">
      <div>
        <h3>Danh sách nhóm</h3>
        <p class="groups-summary">
          {{ rangeLabel }}
          <span v-if="totalsPhonesLoading || totals.phones == null" class="groups-summary__phones">
            ·
            <span class="spinner spinner--sm" aria-hidden="true" />
            <span class="sr-only">Đang đếm SĐT…</span>
          </span>
          <span v-else> · {{ totals.phones }} SĐT</span>
        </p>
      </div>
      <button
        v-if="isStaff"
        class="btn btn--primary btn--inline"
        type="button"
        @click="openCreateModal"
      >
        <Plus class="btn__icon" aria-hidden="true" />
        Thêm nhóm
      </button>
    </div>

    <div v-if="isStaff" class="scan-settings-card">
      <div v-if="settingsError" class="alert alert--error">{{ settingsError }}</div>
      <div v-if="settingsMsg" class="alert alert--ok">{{ settingsMsg }}</div>
      <div class="scan-settings-bar">
        <div class="scan-settings-head">
          <strong>Cài đặt quét</strong>
        </div>
        <div class="scan-settings-grid">
        <label class="field">
          <span>Nhóm khả dụng lại sau</span>
          <div class="inline-fields">
            <input v-model.number="scanSettings.groupCooldownValue" type="number" min="0" />
            <select v-model="scanSettings.groupCooldownUnit">
              <option value="day">ngày</option>
              <option value="month">tháng</option>
              <option value="year">năm</option>
            </select>
          </div>
        </label>
        <label class="field">
          <span>Mốc dừng (10 bài liên tiếp cũ hơn)</span>
          <input v-model="scanSettings.scanCutoffDate" type="date" />
        </label>
        <label class="field">
          <span>Trùng liên tiếp để dừng</span>
          <input v-model.number="scanSettings.duplicateStreakLimit" type="number" min="1" />
        </label>
        <label class="field">
          <span>Timeout claim (phút)</span>
          <input v-model.number="scanSettings.claimTimeoutMinutes" type="number" min="5" />
        </label>
        <label class="field">
          <span>Poll chờ nhóm (giây)</span>
          <input v-model.number="scanSettings.claimPollSeconds" type="number" min="3" />
        </label>
        </div>
        <button
          class="btn btn--primary btn--inline"
          type="button"
          :disabled="settingsBusy"
          @click="saveScanSettings"
        >
          <span v-if="settingsBusy" class="spinner spinner--sm" aria-hidden="true" />
          <Save v-else class="btn__icon" aria-hidden="true" />
          {{ settingsBusy ? 'Đang lưu…' : 'Lưu' }}
        </button>
      </div>
    </div>

    <div class="posts-control">
      <div class="posts-filter-panel">
        <label class="pf-field">
          <span class="sr-only">Tìm nhóm</span>
          <input
            id="group-search"
            v-model="searchQuery"
            class="pf-field__control"
            type="search"
            placeholder="Tìm uid, tên, link…"
          />
        </label>
        <label class="pf-field">
          <span class="pf-field__label">Trạng thái</span>
          <select
            v-model="statusFilter"
            class="pf-field__control"
            aria-label="Lọc theo trạng thái"
          >
            <option value="">Tất cả</option>
            <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <div class="pf-field pf-field--span">
          <span class="pf-field__label">Scanned at</span>
          <div class="pf-dates">
            <input
              v-model="scannedFrom"
              class="pf-field__control"
              type="date"
              aria-label="Scanned từ ngày"
            />
            <span class="pf-dates__sep" aria-hidden="true">→</span>
            <input
              v-model="scannedTo"
              class="pf-field__control"
              type="date"
              aria-label="Scanned đến ngày"
            />
          </div>
        </div>
        <label class="pf-field">
          <span class="pf-field__label">Trang</span>
          <select v-model.number="pageLimit" class="pf-field__control" aria-label="Số nhóm mỗi trang">
            <option v-for="n in PAGE_LIMIT_OPTIONS" :key="n" :value="n">{{ n }} / trang</option>
          </select>
        </label>
      </div>
    </div>

    <div v-if="error" class="alert alert--error">{{ error }}</div>
    <div v-if="actionError" class="alert alert--error">{{ actionError }}</div>
    <div v-if="actionMsg" class="alert alert--ok">{{ actionMsg }}</div>

    <LoadingState v-if="loading" block-layout label="Đang tải nhóm…" />

    <div v-if="groups.length" class="table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>UID</th>
            <th>Tên</th>
            <th>Link</th>
            <th>Bài đăng</th>
            <th>SĐT</th>
            <th>Trạng thái</th>
            <th>Khả dụng</th>
            <th>Lý do dừng</th>
            <th>Scanned at</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in groups"
            :key="g.id"
            class="group-row"
            tabindex="0"
            @click="openDetailModal(g)"
            @keydown.enter.prevent="openDetailModal(g)"
          >
            <td class="mono">{{ g.uid }}</td>
            <td>{{ g.name || '—' }}</td>
            <td class="cell-clip" @click.stop>
              <a v-if="g.link" :href="g.link" target="_blank" rel="noopener noreferrer">
                {{ g.link }}
              </a>
              <span v-else>—</span>
            </td>
            <td class="mono" @click.stop>
              <RouterLink
                class="table-link"
                :to="{ name: 'posts', query: { groupId: g.uid } }"
                :title="`Xem bài đăng của nhóm ${g.uid}`"
              >
                {{ g.postCount || 0 }}
              </RouterLink>
            </td>
            <td class="mono phone-count-cell" @click.stop>
              <span
                v-if="g.phoneLoading || g.phoneCount == null"
                class="phone-count-cell__loading"
                :title="`Đang đếm SĐT nhóm ${g.uid}`"
              >
                <span class="spinner spinner--sm" aria-hidden="true" />
                <span class="sr-only">Đang tải SĐT</span>
              </span>
              <RouterLink
                v-else
                class="table-link"
                :to="{ name: 'posts', query: { groupId: g.uid, view: 'phone' } }"
                :title="`Xem SĐT của nhóm ${g.uid}`"
              >
                {{ g.phoneCount }}
              </RouterLink>
            </td>
            <td @click.stop>
              <div class="status-cell">
                <select
                  v-if="isStaff"
                  class="status-select"
                  :value="g.status"
                  :disabled="busyId === g.id"
                  @change="onStatusChange(g, $event)"
                >
                  <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.value === 'active' && g.claimedBy ? claimLabel(g) : opt.label }}
                  </option>
                </select>
                <span v-else :class="statusClass(g.status)">{{ statusDisplay(g) }}</span>
              </div>
            </td>
            <td class="muted">
              <span v-if="g.status === 'active'">{{ claimLabel(g) }}</span>
              <span v-else-if="g.isAvailable" class="tag tag--status-active">Sẵn sàng</span>
              <span v-else>{{ formatMs(g.availableAt) }}</span>
            </td>
            <td class="muted">{{ stopReasonLabel(g.lastStopReason) }}</td>
            <td class="muted">{{ formatScannedAt(g.scannedAt) }}</td>
            <td class="muted cell-clip">{{ g.note || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty">
      {{ hasListFilter || totalAll ? 'Không có nhóm khớp bộ lọc.' : 'Chưa có nhóm nào.' }}
    </p>

    <div v-if="total > pageLimit" class="pagination">
      <button
        class="btn btn--ghost btn--tiny"
        type="button"
        :disabled="loading || page <= 1"
        @click="goToPage(page - 1)"
      >
        Trước
      </button>

      <button
        v-if="pageNumbers[0] > 1"
        class="page-btn"
        type="button"
        :disabled="loading"
        @click="goToPage(1)"
      >
        1
      </button>
      <span v-if="pageNumbers[0] > 2" class="page-ellipsis">…</span>

      <button
        v-for="n in pageNumbers"
        :key="n"
        class="page-btn"
        type="button"
        :class="{ active: n === page }"
        :disabled="loading"
        @click="goToPage(n)"
      >
        {{ n }}
      </button>

      <span v-if="pageNumbers[pageNumbers.length - 1] < totalPages - 1" class="page-ellipsis">…</span>
      <button
        v-if="pageNumbers[pageNumbers.length - 1] < totalPages"
        class="page-btn"
        type="button"
        :disabled="loading"
        @click="goToPage(totalPages)"
      >
        {{ totalPages }}
      </button>

      <button
        class="btn btn--ghost btn--tiny"
        type="button"
        :disabled="loading || page >= totalPages"
        @click="goToPage(page + 1)"
      >
        Sau
      </button>

      <span class="muted page-meta">Trang {{ page }}/{{ totalPages }}</span>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="showDetailModal && detailGroup"
      class="modal-overlay fade-in"
      @click.self="closeDetailModal"
    >
      <div
        class="modal-card modal-card--group slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-detail-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="group-detail-title">{{ detailGroup.name || 'Chi tiết nhóm' }}</h3>
            <p class="mono">{{ detailGroup.uid }}</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closeDetailModal">
            ×
          </button>
        </div>

        <div v-if="detailError" class="alert alert--error">{{ detailError }}</div>
        <div v-if="detailMsg" class="alert alert--ok">{{ detailMsg }}</div>

        <div class="group-detail-grid">
          <div>
            <span class="muted">Trạng thái</span>
            <p>
              <span :class="statusClass(detailGroup.status)">
                {{ statusDisplay(detailGroup) }}
              </span>
            </p>
          </div>
          <div>
            <span class="muted">Bài đăng</span>
            <p class="mono">{{ detailGroup.postCount || 0 }}</p>
          </div>
          <div>
            <span class="muted">SĐT</span>
            <p class="mono">
              <span v-if="detailGroup.phoneLoading || detailGroup.phoneCount == null" class="phone-count-cell__loading">
                <span class="spinner spinner--sm" aria-hidden="true" />
              </span>
              <template v-else>{{ detailGroup.phoneCount }}</template>
            </p>
          </div>
          <div>
            <span class="muted">Lý do dừng</span>
            <p>{{ stopReasonLabel(detailGroup.lastStopReason) }}</p>
          </div>
          <div>
            <span class="muted">Scanned at</span>
            <p>{{ formatScannedAt(detailGroup.scannedAt) }}</p>
          </div>
          <div>
            <span class="muted">Khả dụng</span>
            <p>
              <template v-if="detailGroup.status === 'active'">
                {{ claimLabel(detailGroup) }}
              </template>
              <template v-else-if="detailGroup.isAvailable">Sẵn sàng</template>
              <template v-else>{{ formatMs(detailGroup.availableAt) }}</template>
            </p>
          </div>
        </div>

        <a
          v-if="detailGroup.link"
          class="group-detail-link"
          :href="detailGroup.link"
          :title="detailGroup.link"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ detailGroup.link }}
        </a>
        <p v-if="detailGroup.note" class="muted group-detail-note">{{ detailGroup.note }}</p>

        <div class="modal-actions group-detail-actions">
          <RouterLink
            class="btn btn--primary btn--inline"
            :to="{ name: 'posts', query: { groupId: detailGroup.uid, view: 'post' } }"
          >
            Xem bài đăng
          </RouterLink>
          <button
            v-if="isStaff"
            class="btn btn--ghost btn--inline danger-text"
            type="button"
            :disabled="deletePostsBusy || deleteGroupBusy || !(detailGroup.postCount > 0)"
            @click="onDeleteGroupPosts"
          >
            <span v-if="deletePostsBusy" class="spinner spinner--sm" aria-hidden="true" />
            {{
              deletePostsBusy
                ? 'Đang xóa…'
                : `Xóa hết bài đăng (${detailGroup.postCount || 0})`
            }}
          </button>
          <button
            v-if="isStaff"
            class="btn btn--ghost btn--inline danger-text"
            type="button"
            :disabled="deleteGroupBusy || deletePostsBusy"
            @click="onDeleteGroup"
          >
            <span v-if="deleteGroupBusy" class="spinner spinner--sm" aria-hidden="true" />
            {{ deleteGroupBusy ? 'Đang xóa…' : 'Xóa nhóm' }}
          </button>
          <button class="btn btn--ghost" type="button" @click="closeDetailModal">Đóng</button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="showCreateModal"
      class="modal-overlay fade-in"
      @click.self="closeCreateModal"
    >
      <div class="modal-card slide-up" role="dialog" aria-modal="true" aria-labelledby="group-create-title">
        <div class="modal-head">
          <div>
            <h3 id="group-create-title">Thêm nhóm</h3>
            <p>Chỉ admin mới được thêm nhóm</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closeCreateModal">
            ×
          </button>
        </div>

        <form @submit.prevent="onCreateGroup">
          <div v-if="createError" class="alert alert--error">{{ createError }}</div>
          <div v-if="createOk" class="alert alert--ok">{{ createOk }}</div>

          <div class="field">
            <label for="group-link">Link nhóm</label>
            <input
              id="group-link"
              v-model="createForm.link"
              placeholder="https://www.facebook.com/groups/…"
              autofocus
            />
          </div>
          <div class="field">
            <label for="group-uid">UID</label>
            <input
              id="group-uid"
              v-model="createForm.uid"
              placeholder="Để trống nếu đã dán link"
            />
          </div>
          <div class="field">
            <label for="group-name">Tên nhóm</label>
            <input id="group-name" v-model="createForm.name" placeholder="Tùy chọn" />
          </div>
          <div class="field">
            <label for="group-status">Trạng thái</label>
            <select id="group-status" v-model="createForm.status">
              <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="group-note">Ghi chú</label>
            <input id="group-note" v-model="createForm.note" placeholder="Tùy chọn" />
          </div>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="closeCreateModal">Hủy</button>
            <button class="btn btn--primary btn--inline" type="submit" :disabled="createBusy">
              <span v-if="createBusy" class="spinner spinner--sm" aria-hidden="true" />
              {{ createBusy ? 'Đang lưu…' : 'Thêm nhóm' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
