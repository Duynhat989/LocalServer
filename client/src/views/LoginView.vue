<script setup>
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuth } from '../composables/useAuth';

const router = useRouter();
const route = useRoute();
const { login } = useAuth();

const form = reactive({
  username: '',
  password: '',
});
const showPassword = ref(false);
const error = ref('');
const busy = ref(false);

async function onSubmit() {
  error.value = '';
  busy.value = true;
  try {
    await login(form.username.trim(), form.password);
    form.password = '';
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(redirect || '/');
  } catch (err) {
    error.value = err.message || 'Đăng nhập thất bại';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page fade-in">
    <div class="login-bg" aria-hidden="true">
      <span class="orb orb-a" />
      <span class="orb orb-b" />
      <span class="orb orb-c" />
    </div>

    <header class="login-nav">
      <div class="brand">
        <img class="logo" src="/logo.png" alt="LocalServer" width="32" height="32" />
        <span class="brand-name">LocalServer</span>
      </div>
      <span class="chip chip--soft">http://127.0.0.1:6868</span>
    </header>

    <main class="login-main">
      <section class="login-intro slide-up">
        <img class="logo logo--hero pulse" src="/logo.png" alt="" width="64" height="64" />
        <h1 class="login-brand">LocalServer</h1>
        <p class="login-tagline">
          Đăng nhập để quản lý tài khoản trên máy local — nhanh, riêng tư, không cần cloud.
        </p>
      </section>

      <form class="login-card slide-up delay-1" @submit.prevent="onSubmit">
        <div class="login-card-head">
          <h2>Đăng nhập</h2>
          <p>Nhập tài khoản để tiếp tục</p>
        </div>

        <div v-if="error" class="alert alert--error">{{ error }}</div>

        <div class="field">
          <label for="username">Tên đăng nhập</label>
          <div class="input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path
                  d="M20 21a8 8 0 1 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <input
              id="username"
              v-model="form.username"
              placeholder="admin"
              autocomplete="username"
              required
            />
          </div>
        </div>

        <div class="field">
          <label for="password">Mật khẩu</label>
          <div class="input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path
                  d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11Z"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <input
              id="password"
              :type="showPassword ? 'text' : 'password'"
              v-model="form.password"
              placeholder="••••••••"
              autocomplete="current-password"
              required
            />
            <button
              class="toggle-pass"
              type="button"
              :aria-label="showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? 'Ẩn' : 'Hiện' }}
            </button>
          </div>
        </div>

        <button class="btn btn--primary login-submit" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner spinner--sm" aria-hidden="true" />
          <span>{{ busy ? 'Đang đăng nhập…' : 'Đăng nhập' }}</span>
          <svg v-if="!busy" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </form>
    </main>
  </div>
</template>
