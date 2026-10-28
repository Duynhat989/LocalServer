<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Save } from '@lucide/vue';
import { api } from '../api';
import { confirmDialog } from '../composables/useDialog';
import { useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Chờ quét' },
  { value: 'active', label: 'Đang quét' },
  { value: 'paused', label: 'Tạm dừng' },
  { value: 'done', label: 'Xong' },
  { value: 'error', label: 'Lỗi' },
];

const { token, isStaff } = useAuth();
const groups = ref([]);
const totals = ref({ posts: 0, phones: 0 });
const loading = ref(true);
const error = ref('');
const searchQuery = ref('');
const actionMsg = ref('');
const actionError = ref('');
const busyId = ref(null);

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

function statusClass(value) {
  return `tag tag--status-${value || 'pending'}`;
}

function formatScannedAt(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const ms = n < 1e12 ? n * 1000 : n;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
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

const filteredGroups = computed(() => {
  const q = String(searchQuery.value || '')
    .trim()
    .toLowerCase();
  if (!q) return groups.value;
  return groups.value.filter((g) => {
    const hay = [g.uid, g.name, g.link, g.status, g.note, statusLabel(g.status)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
});

async function loadGroups() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api('/api/groups', { token: token.value });
    groups.value = data.groups || [];
    totals.value = {
      posts: Number(data.totals?.posts) || 0,
      phones: Number(data.totals?.phones) || 0,
    };
  } catch (err) {
    error.value = err.message || 'Không tải được nhóm';
  } finally {
    loading.value = false;
  }
}

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
    if (data.group) {
      groups.value = [data.group, ...groups.value.filter((g) => g.id !== data.group.id)];
    } else {
      await loadGroups();
    }
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
    groups.value = groups.value.filter((g) => g.id !== group.id);
    totals.value = {
      posts: Math.max(0, (totals.value.posts || 0) - count),
      phones: Math.max(0, (totals.value.phones || 0) - (Number(group.phoneCount) || 0)),
    };
    deleteGroupBusy.value = false;
    closeDetailModal();
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
        <p>
          {{ filteredGroups.length }} nhóm
          <span v-if="searchQuery.trim()"> · lọc từ {{ groups.length }}</span>
          · {{ totals.posts }} bài · {{ totals.phones }} SĐT
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

    <div class="posts-toolbar">
      <div class="search-box">
        <label class="sr-only" for="group-search">Tìm nhóm</label>
        <input
          id="group-search"
          v-model="searchQuery"
          type="search"
          placeholder="Tìm uid, tên, link, trạng thái…"
        />
      </div>
    </div>

    <div v-if="error" class="alert alert--error">{{ error }}</div>
    <div v-if="actionError" class="alert alert--error">{{ actionError }}</div>
    <div v-if="actionMsg" class="alert alert--ok">{{ actionMsg }}</div>

    <LoadingState v-if="loading && !groups.length" label="Đang tải nhóm…" />

    <div
      v-else-if="filteredGroups.length"
      class="panel-loading-wrap table-wrap"
      :class="{ 'is-loading': loading }"
    >
      <LoadingState v-if="loading" overlay label="Đang tải…" />
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
            v-for="g in filteredGroups"
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
            <td class="mono" @click.stop>
              <RouterLink
                class="table-link"
                :to="{ name: 'posts', query: { groupId: g.uid, view: 'phone' } }"
                :title="`Xem SĐT của nhóm ${g.uid}`"
              >
                {{ g.phoneCount || 0 }}
              </RouterLink>
            </td>
            <td @click.stop>
              <select
                v-if="isStaff"
                class="status-select"
                :value="g.status"
                :disabled="busyId === g.id"
                @change="onStatusChange(g, $event)"
              >
                <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
              <span v-else :class="statusClass(g.status)">{{ statusLabel(g.status) }}</span>
            </td>
            <td class="muted">
              <span v-if="g.status === 'active'">Đang claim · {{ g.claimedBy || '—' }}</span>
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
    <p v-else class="empty">Chưa có nhóm nào.</p>
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
                {{ statusLabel(detailGroup.status) }}
              </span>
            </p>
          </div>
          <div>
            <span class="muted">Bài đăng</span>
            <p class="mono">{{ detailGroup.postCount || 0 }}</p>
          </div>
          <div>
            <span class="muted">SĐT</span>
            <p class="mono">{{ detailGroup.phoneCount || 0 }}</p>
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
                Đang claim · {{ detailGroup.claimedBy || '—' }}
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
