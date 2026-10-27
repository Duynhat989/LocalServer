<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { LogOut } from '@lucide/vue';
import { useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const router = useRouter();
const { user, isStaff, roleLabel, logout } = useAuth();

const initials = computed(() => {
  const name = user.value?.username || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
});

async function onLogout() {
  await logout();
  router.replace({ name: 'login' });
}
</script>

<template>
  <div class="stage stage--app fade-in">
    <header class="nav">
      <div class="brand">
        <img class="logo" src="/logo.png" alt="LocalServer" width="32" height="32" />
        <span class="brand-name">LocalServer</span>
      </div>

      <nav class="nav-links" aria-label="Chính">
        <RouterLink class="nav-link" exact-active-class="is-active" :to="{ name: 'home' }">
          Trang chủ
        </RouterLink>
        <RouterLink
          v-if="isStaff"
          class="nav-link"
          exact-active-class="is-active"
          :to="{ name: 'posts' }"
        >
          Bài đăng
        </RouterLink>
        <RouterLink
          v-if="isStaff"
          class="nav-link"
          exact-active-class="is-active"
          :to="{ name: 'groups' }"
        >
          Nhóm
        </RouterLink>
        <RouterLink class="nav-link" exact-active-class="is-active" :to="{ name: 'campaigns' }">
          Chiến dịch
        </RouterLink>
      </nav>

      <div class="nav-right">
        <span class="chip chip--orange">{{ roleLabel(user?.role) }}</span>
        <RouterLink class="profile" :to="{ name: 'profile' }" title="Hồ sơ">
          <div class="avatar">{{ initials }}</div>
          <span>{{ user?.username }}</span>
        </RouterLink>
        <button class="btn btn--ghost" type="button" @click="onLogout">
          <LogOut class="btn__icon" aria-hidden="true" />
          Đăng xuất
        </button>
      </div>
    </header>

    <main class="content">
      <router-view v-slot="{ Component }">
        <Suspense>
          <component :is="Component" />
          <template #fallback>
            <LoadingState />
          </template>
        </Suspense>
      </router-view>
    </main>
  </div>
</template>
