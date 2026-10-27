<script setup>
import AppDialog from './components/AppDialog.vue';
import { useAuth } from './composables/useAuth';

const { loading } = useAuth();
</script>

<template>
  <div v-if="loading" class="stage stage--center fade-in">
    <div class="loader">
      <img class="logo logo--lg pulse" src="/logo.png" alt="LocalServer" width="64" height="64" />
      <span class="spinner" aria-hidden="true" />
      <p>Đang khởi tạo…</p>
    </div>
  </div>
  <router-view v-else />
  <AppDialog />
</template>
