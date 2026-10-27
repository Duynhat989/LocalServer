<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Copy, KeyRound, Plus, ShieldOff, Trash2 } from '@lucide/vue';
import { api } from '../api';
import { confirmDialog } from '../composables/useDialog';
import { roleLabel, useAuth } from '../composables/useAuth';
import HistoryView from './HistoryView.vue';
import UsersView from './UsersView.vue';

const route = useRoute();
const router = useRouter();
const { user, token, isAdmin, isStaff, changePassword, logout } = useAuth();

const showPasswordForm = ref(false);
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const error = ref('');
const ok = ref('');
const busy = ref(false);

const sessions = ref([]);
const sessionsLoading = ref(false);
const sessionsError = ref('');
const sessionBusyId = ref(null);
const revokeOthersBusy = ref(false);

const apiKeys = ref([]);
const apiKeysLoading = ref(false);
const apiKeysError = ref('');
const createName = ref('');
const createBusy = ref(false);
const deleteBusyId = ref(null);
const newlyCreatedKey = ref(null);
const copyMsg = ref('');
const activeTab = ref('sessions');

const initials = computed(() => {
  const name = user.value?.username || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
});

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function openPasswordForm() {
  error.value = '';
  ok.value = '';
  form.currentPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  showPasswordForm.value = true;
}

function closePasswordForm() {
  if (busy.value) return;
  showPasswordForm.value = false;
}

async function onChangePassword() {
  error.value = '';
  ok.value = '';

  if (form.newPassword.length < 4) {
    error.value = 'Mật khẩu mới tối thiểu 4 ký tự';
    return;
  }
  if (form.newPassword !== form.confirmPassword) {
    error.value = 'Xác nhận mật khẩu không khớp';
    return;
  }

  busy.value = true;
  try {
    const data = await changePassword(form.currentPassword, form.newPassword);
    ok.value = data.message || 'Đổi mật khẩu thành công';
    form.currentPassword = '';
    form.newPassword = '';
    form.confirmPassword = '';
    setTimeout(() => {
      showPasswordForm.value = false;
      ok.value = '';
    }, 900);
  } catch (err) {
    error.value = err.message || 'Không đổi được mật khẩu';
  } finally {
    busy.value = false;
  }
}

async function loadSessions() {
  sessionsLoading.value = true;
  sessionsError.value = '';
  try {
    const data = await api('/api/sessions', { token: token.value });
    sessions.value = data.sessions || [];
  } catch (err) {
    sessionsError.value = err.message || 'Không tải được danh sách phiên';
  } finally {
    sessionsLoading.value = false;
  }
}

async function onRevokeSession(row) {
  const label = row.isCurrent ? 'phiên hiện tại. Bạn sẽ phải đăng nhập lại' : 'phiên này';
  const password = await confirmDialog({
    title: 'Thu hồi phiên',
    message: `Nhập mật khẩu để xác minh trước khi thu hồi ${label}.`,
    confirmText: 'Thu hồi',
    danger: true,
    requirePassword: true,
  });
  if (!password) return;

  sessionBusyId.value = row.id;
  sessionsError.value = '';
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
      token: token.value,
      body: { password },
    });
    if (data.revokedCurrent) {
      await logout();
      return;
    }
    await loadSessions();
  } catch (err) {
    sessionsError.value = err.message || 'Không thu hồi được phiên';
  } finally {
    sessionBusyId.value = null;
  }
}

async function onRevokeOtherSessions() {
  const password = await confirmDialog({
    title: 'Thu hồi phiên khác',
    message: 'Nhập mật khẩu để xác minh trước khi thu hồi tất cả phiên khác. Phiên hiện tại được giữ lại.',
    confirmText: 'Thu hồi',
    danger: true,
    requirePassword: true,
  });
  if (!password) return;
  revokeOthersBusy.value = true;
  sessionsError.value = '';
  try {
    await api('/api/sessions/others', {
      method: 'DELETE',
      token: token.value,
      body: { password },
    });
    await loadSessions();
  } catch (err) {
    sessionsError.value = err.message || 'Không thu hồi được các phiên khác';
  } finally {
    revokeOthersBusy.value = false;
  }
}

async function loadApiKeys() {
  apiKeysLoading.value = true;
  apiKeysError.value = '';
  try {
    const data = await api('/api/api-keys', { token: token.value });
    apiKeys.value = data.apiKeys || [];
  } catch (err) {
    apiKeysError.value = err.message || 'Không tải được API key';
  } finally {
    apiKeysLoading.value = false;
  }
}

async function onCreateApiKey() {
  createBusy.value = true;
  apiKeysError.value = '';
  copyMsg.value = '';
  try {
    const data = await api('/api/api-keys', {
      method: 'POST',
      token: token.value,
      body: { name: createName.value.trim() || 'API Key' },
    });
    newlyCreatedKey.value = data.apiKey || null;
    createName.value = '';
    await loadApiKeys();
  } catch (err) {
    apiKeysError.value = err.message || 'Không tạo được API key';
  } finally {
    createBusy.value = false;
  }
}

async function onDeleteApiKey(row) {
  const okConfirm = await confirmDialog({
    title: 'Xóa API key',
    message: `Xóa API key “${row.name}”? Token này sẽ không dùng được nữa.`,
    confirmText: 'Xóa',
    danger: true,
  });
  if (!okConfirm) return;
  deleteBusyId.value = row.id;
  apiKeysError.value = '';
  try {
    await api(`/api/api-keys/${row.id}`, {
      method: 'DELETE',
      token: token.value,
    });
    if (newlyCreatedKey.value?.id === row.id) newlyCreatedKey.value = null;
    await loadApiKeys();
  } catch (err) {
    apiKeysError.value = err.message || 'Không xóa được API key';
  } finally {
    deleteBusyId.value = null;
  }
}

async function copyText(value) {
  const text = String(value || '');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
  copyMsg.value = 'Đã sao chép API key';
  setTimeout(() => {
    copyMsg.value = '';
  }, 1800);
}

function selectTab(id) {
  if (id === 'users' && !isAdmin.value) return;
  if (id === 'history' && !isStaff.value) return;
  activeTab.value = id;
  const query = id === 'sessions' ? {} : { tab: id };
  router.replace({ name: 'profile', query });
}

function applyTabFromRoute() {
  const tab = String(route.query.tab || '');
  if (tab === 'users' && isAdmin.value) activeTab.value = 'users';
  else if (tab === 'history' && isStaff.value) activeTab.value = 'history';
  else if (tab === 'apikeys') activeTab.value = 'apikeys';
  else if (!tab) activeTab.value = 'sessions';
}

watch(() => route.query.tab, applyTabFromRoute);

onMounted(() => {
  applyTabFromRoute();
  loadSessions();
  loadApiKeys();
});
</script>

<template>
  <section class="profile-page">
    <div class="profile-card profile-card--hero">
      <div class="profile-hero">
        <div class="avatar avatar--lg">{{ initials }}</div>
        <div>
          <h2>{{ user?.username }}</h2>
          <p class="muted">Vai trò: {{ roleLabel(user?.role) }}</p>
        </div>
      </div>

      <div class="profile-actions">
        <button class="btn btn--primary btn--inline" type="button" @click="openPasswordForm">
          <KeyRound class="btn__icon" aria-hidden="true" />
          Đổi mật khẩu
        </button>
      </div>
    </div>

    <div class="profile-card profile-card--wide">
      <div class="view-tabs profile-tabs" role="tablist" aria-label="Quản lý bảo mật">
        <button
          type="button"
          class="view-tab"
          role="tab"
          :aria-selected="activeTab === 'sessions'"
          :class="{ active: activeTab === 'sessions' }"
          @click="selectTab('sessions')"
        >
          Session ({{ sessions.length }})
        </button>
        <button
          type="button"
          class="view-tab"
          role="tab"
          :aria-selected="activeTab === 'apikeys'"
          :class="{ active: activeTab === 'apikeys' }"
          @click="selectTab('apikeys')"
        >
          API Key ({{ apiKeys.length }})
        </button>
        <button
          v-if="isStaff"
          type="button"
          class="view-tab"
          role="tab"
          :aria-selected="activeTab === 'history'"
          :class="{ active: activeTab === 'history' }"
          @click="selectTab('history')"
        >
          Lịch sử
        </button>
        <button
          v-if="isAdmin"
          type="button"
          class="view-tab"
          role="tab"
          :aria-selected="activeTab === 'users'"
          :class="{ active: activeTab === 'users' }"
          @click="selectTab('users')"
        >
          Người dùng
        </button>
      </div>

      <div v-show="activeTab === 'sessions'" class="profile-tab-panel">
        <div class="profile-section-head profile-section-head--row">
          <div>
            <h3>Phiên đăng nhập</h3>
            <p class="muted">
              Mỗi lần đăng nhập tạo một JWT trong DB. Xóa phiên = token đó không dùng được nữa.
            </p>
          </div>
          <button
            class="btn btn--ghost btn--inline"
            type="button"
            :disabled="revokeOthersBusy || sessionsLoading || sessions.length <= 1"
            @click="onRevokeOtherSessions"
          >
            <ShieldOff class="btn__icon" aria-hidden="true" />
            {{ revokeOthersBusy ? 'Đang thu hồi…' : 'Thu hồi phiên khác' }}
          </button>
        </div>

        <div v-if="sessionsError" class="alert alert--error">{{ sessionsError }}</div>
        <div v-if="sessionsLoading" class="muted">Đang tải phiên…</div>
        <div v-else-if="sessions.length" class="table-wrap">
          <table class="user-table">
            <thead>
              <tr>
                <th>Trạng thái</th>
                <th>Token</th>
                <th>Tạo lúc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sessions" :key="row.id">
                <td>
                  <span
                    :class="row.isCurrent ? 'tag tag--status-active' : 'tag tag--status-done'"
                  >
                    {{ row.isCurrent ? 'Phiên hiện tại' : 'Phiên khác' }}
                  </span>
                </td>
                <td class="mono cell-clip" :title="row.id">{{ row.tokenPreview }}</td>
                <td class="muted">{{ formatDate(row.created_at) }}</td>
                <td>
                  <button
                    class="btn btn--ghost btn--tiny"
                    type="button"
                    :disabled="sessionBusyId === row.id"
                    @click="onRevokeSession(row)"
                  >
                    <Trash2 class="btn__icon" aria-hidden="true" />
                    {{ sessionBusyId === row.id ? '…' : 'Thu hồi' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty">Chưa có phiên đăng nhập.</p>
      </div>

      <div v-show="activeTab === 'apikeys'" class="profile-tab-panel">
        <div class="profile-section-head">
          <h3>API Key</h3>
          <p class="muted">
            Dùng header <span class="mono">Authorization: Bearer ls_…</span> để gọi API.
            Xóa key = thu hồi ngay.
          </p>
        </div>

        <form class="apikey-create" @submit.prevent="onCreateApiKey">
          <input
            v-model="createName"
            type="text"
            maxlength="120"
            placeholder="Tên key (vd: Extension, Script…)"
            :disabled="createBusy"
          />
          <button class="btn btn--primary btn--inline" type="submit" :disabled="createBusy">
            <Plus class="btn__icon" aria-hidden="true" />
            {{ createBusy ? 'Đang tạo…' : 'Tạo API key' }}
          </button>
        </form>

        <div v-if="newlyCreatedKey?.key" class="apikey-created alert alert--ok">
          <div>
            <strong>Key mới — chỉ hiện một lần</strong>
            <p class="mono apikey-secret">{{ newlyCreatedKey.key }}</p>
          </div>
          <button
            class="btn btn--ghost btn--tiny"
            type="button"
            @click="copyText(newlyCreatedKey.key)"
          >
            <Copy class="btn__icon" aria-hidden="true" />
            Sao chép
          </button>
        </div>
        <p v-if="copyMsg" class="muted apikey-copy-msg">{{ copyMsg }}</p>
        <div v-if="apiKeysError" class="alert alert--error">{{ apiKeysError }}</div>

        <div v-if="apiKeysLoading" class="muted">Đang tải API key…</div>
        <div v-else-if="apiKeys.length" class="table-wrap">
          <table class="user-table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Prefix</th>
                <th>Tạo lúc</th>
                <th>Dùng gần nhất</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in apiKeys" :key="row.id">
                <td>{{ row.name }}</td>
                <td class="mono">{{ row.keyPrefix }}</td>
                <td class="muted">{{ formatDate(row.created_at) }}</td>
                <td class="muted">{{ formatDate(row.lastUsedAt) }}</td>
                <td>
                  <button
                    class="btn btn--ghost btn--tiny"
                    type="button"
                    :disabled="deleteBusyId === row.id"
                    @click="onDeleteApiKey(row)"
                  >
                    <Trash2 class="btn__icon" aria-hidden="true" />
                    {{ deleteBusyId === row.id ? '…' : 'Xóa' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty">Chưa có API key.</p>
      </div>

      <div v-if="isStaff && activeTab === 'history'" class="profile-tab-panel">
        <HistoryView embedded />
      </div>
      <div v-if="isAdmin && activeTab === 'users'" class="profile-tab-panel">
        <UsersView embedded />
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="showPasswordForm"
      class="modal-overlay fade-in"
      @click.self="closePasswordForm"
    >
      <div class="modal-card slide-up" role="dialog" aria-modal="true" aria-labelledby="pwd-title">
        <div class="modal-head">
          <div>
            <h3 id="pwd-title">Đổi mật khẩu</h3>
            <p>Nhập mật khẩu hiện tại và mật khẩu mới</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closePasswordForm">
            ×
          </button>
        </div>

        <form @submit.prevent="onChangePassword">
          <div v-if="error" class="alert alert--error">{{ error }}</div>
          <div v-if="ok" class="alert alert--ok">{{ ok }}</div>

          <div class="field">
            <label for="current-password">Mật khẩu hiện tại</label>
            <input
              id="current-password"
              v-model="form.currentPassword"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <div class="field">
            <label for="new-password">Mật khẩu mới</label>
            <input
              id="new-password"
              v-model="form.newPassword"
              type="password"
              autocomplete="new-password"
              required
              minlength="4"
            />
          </div>
          <div class="field">
            <label for="confirm-password">Xác nhận mật khẩu mới</label>
            <input
              id="confirm-password"
              v-model="form.confirmPassword"
              type="password"
              autocomplete="new-password"
              required
              minlength="4"
            />
          </div>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="closePasswordForm">Hủy</button>
            <button class="btn btn--primary btn--inline" type="submit" :disabled="busy">
              <span v-if="busy" class="spinner spinner--sm" aria-hidden="true" />
              {{ busy ? 'Đang lưu…' : 'Lưu mật khẩu' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
