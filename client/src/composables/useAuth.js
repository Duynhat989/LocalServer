import { computed, ref } from 'vue';
import { api } from '../api';

const TOKEN_KEY = 'localserver_token';
const USER_KEY = 'localserver_user';

const token = ref(localStorage.getItem(TOKEN_KEY) || '');
const user = ref(readStoredUser());
const loading = ref(true);
const users = ref([]);

let bootstrapPromise = null;

const isAdmin = computed(() => user.value?.role === 'admin');
const isStaff = computed(() => user.value?.role === 'admin' || user.value?.role === 'manager');
const isAuthenticated = computed(() => !!token.value && !!user.value);

export function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'manager') return 'Quản lý';
  return 'User';
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistSession(nextToken, nextUser) {
  token.value = nextToken || '';
  user.value = nextUser || null;

  if (nextToken && nextUser) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

function clearSession() {
  token.value = '';
  user.value = null;
  users.value = [];
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function loadUsers() {
  const data = await api('/api/users', { token: token.value });
  users.value = data.users || [];
}

async function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    loading.value = true;

    const savedToken = localStorage.getItem(TOKEN_KEY) || '';
    token.value = savedToken;

    if (!savedToken) {
      clearSession();
      loading.value = false;
      return;
    }

    try {
      const data = await api('/api/me', { token: savedToken });
      persistSession(savedToken, data.user);
      if (data.user.role === 'admin') {
        await loadUsers();
      }
    } catch {
      clearSession();
    } finally {
      loading.value = false;
    }
  })();

  return bootstrapPromise;
}

async function login(username, password) {
  const data = await api('/api/login', {
    method: 'POST',
    body: { username, password },
  });

  persistSession(data.token, data.user);

  if (data.user.role === 'admin') {
    await loadUsers();
  }

  return data.user;
}

async function logout() {
  try {
    if (token.value) {
      await api('/api/logout', { method: 'POST', token: token.value });
    }
  } catch {
    /* ignore */
  }
  clearSession();
}

async function createUser({ username, password, role }) {
  const data = await api('/api/users', {
    method: 'POST',
    token: token.value,
    body: { username, password, role },
  });
  await loadUsers();
  return data.user;
}

async function setUserLocked(id, locked) {
  const data = await api(`/api/users/${id}/lock`, {
    method: 'PATCH',
    token: token.value,
    body: { locked },
  });
  await loadUsers();
  return data;
}

async function resetUserPassword(id) {
  const data = await api(`/api/users/${id}/reset-password`, {
    method: 'POST',
    token: token.value,
  });
  await loadUsers();
  return data;
}

async function deleteUser(id) {
  const data = await api(`/api/users/${id}`, {
    method: 'DELETE',
    token: token.value,
  });
  await loadUsers();
  return data;
}

async function changePassword(currentPassword, newPassword) {
  return api('/api/change-password', {
    method: 'POST',
    token: token.value,
    body: { currentPassword, newPassword },
  });
}

export function useAuth() {
  return {
    token,
    user,
    users,
    loading,
    isAdmin,
    isStaff,
    isAuthenticated,
    roleLabel,
    bootstrap,
    login,
    logout,
    createUser,
    loadUsers,
    setUserLocked,
    resetUserPassword,
    deleteUser,
    changePassword,
  };
}
