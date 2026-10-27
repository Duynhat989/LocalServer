<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { KeyRound, Lock, Trash2, Unlock, UserPlus } from '@lucide/vue';
import { confirmDialog } from '../composables/useDialog';
import { roleLabel, useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const {
  user,
  users,
  createUser,
  loadUsers,
  setUserLocked,
  resetUserPassword,
  deleteUser,
} = useAuth();

defineProps({
  embedded: { type: Boolean, default: false },
});

const loading = ref(true);
const showCreateModal = ref(false);
const createForm = reactive({
  username: '',
  password: '',
  role: 'user',
});
const createError = ref('');
const createOk = ref('');
const createBusy = ref(false);
const actionMsg = ref('');
const actionError = ref('');
const busyId = ref(null);

function userInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function openCreateModal() {
  createError.value = '';
  createOk.value = '';
  createForm.username = '';
  createForm.password = '';
  createForm.role = 'user';
  showCreateModal.value = true;
}

function closeCreateModal() {
  if (createBusy.value) return;
  showCreateModal.value = false;
}

async function onCreateUser() {
  createError.value = '';
  createOk.value = '';
  createBusy.value = true;
  try {
    const name = createForm.username.trim();
    await createUser({
      username: name,
      password: createForm.password,
      role: createForm.role,
    });
    createOk.value = `Đã tạo tài khoản “${name}”`;
    createForm.username = '';
    createForm.password = '';
    createForm.role = 'user';
    setTimeout(() => {
      showCreateModal.value = false;
      createOk.value = '';
    }, 700);
  } catch (err) {
    createError.value = err.message || 'Không tạo được user';
  } finally {
    createBusy.value = false;
  }
}

async function onToggleLock(u) {
  actionMsg.value = '';
  actionError.value = '';
  if (user.value?.id === u.id) {
    actionError.value = 'Không thể khóa chính tài khoản đang đăng nhập';
    return;
  }
  busyId.value = u.id;
  try {
    const data = await setUserLocked(u.id, !u.locked);
    actionMsg.value = data.message || (u.locked ? 'Đã mở khóa' : 'Đã khóa');
  } catch (err) {
    actionError.value = err.message || 'Không cập nhật được trạng thái';
  } finally {
    busyId.value = null;
  }
}

async function onResetPassword(u) {
  actionMsg.value = '';
  actionError.value = '';
  const ok = await confirmDialog({
    title: 'Đặt mật khẩu mặc định',
    message: `Đặt mật khẩu mặc định cho “${u.username}”?\nMật khẩu mới sẽ là: 123456`,
    confirmText: 'Đặt lại',
  });
  if (!ok) return;

  busyId.value = u.id;
  try {
    const data = await resetUserPassword(u.id);
    actionMsg.value = data.message || 'Đã đặt mật khẩu mặc định';
  } catch (err) {
    actionError.value = err.message || 'Không đặt lại mật khẩu được';
  } finally {
    busyId.value = null;
  }
}

async function onDeleteUser(u) {
  actionMsg.value = '';
  actionError.value = '';
  if (user.value?.id === u.id) {
    actionError.value = 'Không thể xóa chính tài khoản đang đăng nhập';
    return;
  }
  const ok = await confirmDialog({
    title: 'Xóa user',
    message: `Xóa user “${u.username}”?\nSession và API key của user này cũng sẽ bị xóa.`,
    confirmText: 'Xóa',
    danger: true,
  });
  if (!ok) return;

  busyId.value = u.id;
  try {
    const data = await deleteUser(u.id);
    actionMsg.value = data.message || `Đã xóa “${u.username}”`;
  } catch (err) {
    actionError.value = err.message || 'Không xóa được user';
  } finally {
    busyId.value = null;
  }
}

watch(showCreateModal, (open) => {
  document.body.style.overflow = open ? 'hidden' : '';
});

onMounted(async () => {
  loading.value = true;
  try {
    await loadUsers();
  } catch {
    /* ignore */
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="users-panel" :class="{ 'users-panel--flat': embedded }">
    <div class="panel-head panel-head--actions">
      <div>
        <h3>Danh sách user</h3>
        <p>{{ users.length }} tài khoản</p>
      </div>
      <button class="btn btn--primary btn--inline" type="button" @click="openCreateModal">
        <UserPlus class="btn__icon" aria-hidden="true" />
        Thêm user
      </button>
    </div>

    <div v-if="actionError" class="alert alert--error">{{ actionError }}</div>
    <div v-if="actionMsg" class="alert alert--ok">{{ actionMsg }}</div>

    <LoadingState v-if="loading && !users.length" label="Đang tải user…" />

    <div
      v-else-if="users.length"
      class="panel-loading-wrap table-wrap"
      :class="{ 'is-loading': loading }"
    >
      <LoadingState v-if="loading" overlay label="Đang tải…" />
      <table class="user-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Người dùng</th>
            <th>Vai trò</th>
            <th>Trạng thái</th>
            <th>Ngày tạo</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :class="{ 'is-locked': u.locked }">
            <td class="mono">{{ u.id }}</td>
            <td>
              <div class="user-cell">
                <div class="avatar avatar--sm">{{ userInitials(u.username) }}</div>
                <strong>{{ u.username }}</strong>
              </div>
            </td>
            <td>
              <span
                class="tag tag--role"
                :class="{
                  'tag--admin': u.role === 'admin',
                  'tag--manager': u.role === 'manager',
                }"
              >
                {{ roleLabel(u.role) }}
              </span>
            </td>
            <td>
              <span class="tag" :class="u.locked ? 'tag--locked' : 'tag--active'">
                {{ u.locked ? 'Đã khóa' : 'Hoạt động' }}
              </span>
            </td>
            <td class="muted">{{ formatDate(u.created_at) }}</td>
            <td>
              <div class="row-actions">
                <button
                  class="btn btn--ghost btn--tiny"
                  type="button"
                  :disabled="busyId === u.id || user?.id === u.id"
                  @click="onToggleLock(u)"
                >
                  <Unlock v-if="u.locked" class="btn__icon" aria-hidden="true" />
                  <Lock v-else class="btn__icon" aria-hidden="true" />
                  {{ u.locked ? 'Mở khóa' : 'Khóa' }}
                </button>
                <button
                  class="btn btn--ghost btn--tiny"
                  type="button"
                  :disabled="busyId === u.id"
                  @click="onResetPassword(u)"
                >
                  <KeyRound class="btn__icon" aria-hidden="true" />
                  MK mặc định
                </button>
                <button
                  class="btn btn--ghost btn--tiny"
                  type="button"
                  :disabled="busyId === u.id || user?.id === u.id"
                  @click="onDeleteUser(u)"
                >
                  <Trash2 class="btn__icon" aria-hidden="true" />
                  Xóa
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty">Chưa có user nào.</p>
  </section>

  <Teleport to="body">
    <div
      v-if="showCreateModal"
      class="modal-overlay fade-in"
      @click.self="closeCreateModal"
    >
      <div class="modal-card slide-up" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div class="modal-head">
          <div>
            <h3 id="create-title">Tạo user mới</h3>
            <p>Chỉ admin mới có quyền này</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closeCreateModal">
            ×
          </button>
        </div>

        <form @submit.prevent="onCreateUser">
          <div v-if="createError" class="alert alert--error">{{ createError }}</div>
          <div v-if="createOk" class="alert alert--ok">{{ createOk }}</div>

          <div class="field">
            <label for="new-username">Tên đăng nhập</label>
            <input
              id="new-username"
              v-model="createForm.username"
              placeholder="vd: nguyenvana"
              required
              minlength="3"
              autofocus
            />
          </div>
          <div class="field">
            <label for="new-password">Mật khẩu</label>
            <input
              id="new-password"
              v-model="createForm.password"
              type="password"
              placeholder="Tối thiểu 4 ký tự"
              required
              minlength="4"
            />
          </div>
          <div class="field">
            <label>Vai trò</label>
            <div class="role-switch role-switch--three" role="group" aria-label="Vai trò">
              <button
                type="button"
                :class="{ active: createForm.role === 'user' }"
                @click="createForm.role = 'user'"
              >
                User
              </button>
              <button
                type="button"
                :class="{ active: createForm.role === 'manager' }"
                @click="createForm.role = 'manager'"
              >
                Quản lý
              </button>
              <button
                type="button"
                :class="{ active: createForm.role === 'admin' }"
                @click="createForm.role = 'admin'"
              >
                Admin
              </button>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="closeCreateModal">Hủy</button>
            <button class="btn btn--primary btn--inline" type="submit" :disabled="createBusy">
              <span v-if="createBusy" class="spinner spinner--sm" aria-hidden="true" />
              {{ createBusy ? 'Đang tạo…' : 'Tạo tài khoản' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
