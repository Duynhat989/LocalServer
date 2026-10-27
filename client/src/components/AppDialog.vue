<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useDialogState } from '../composables/useDialog';

const { state, confirm, cancel } = useDialogState();
const passwordInput = ref(null);

const lines = computed(() =>
  String(state.message || '')
    .split('\n')
    .map((line) => line.trimEnd())
);

const showCancel = computed(() => Boolean(state.cancelText));

watch(
  () => state.open,
  (open) => {
    if (open) document.body.style.overflow = 'hidden';
    else if (
      !document.querySelector('.modal-overlay:not(.app-dialog-overlay)')
    ) {
      document.body.style.overflow = '';
    }
  }
);

function onConfirm() {
  if (state.password) {
    const value = String(state.passwordValue || '');
    if (!value) {
      state.passwordError = 'Nhập mật khẩu để xác minh';
      passwordInput.value?.focus();
      return;
    }
    confirm(value);
    return;
  }
  confirm(true);
}

function onKeydown(event) {
  if (!state.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    onConfirm();
  }
}

watch(
  () => state.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown);
      if (state.password) nextTick(() => passwordInput.value?.focus());
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="modal-overlay fade-in app-dialog-overlay"
      @click.self="cancel"
    >
      <div
        class="modal-card slide-up app-dialog-card"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="state.title ? 'app-dialog-title' : undefined"
        :aria-describedby="'app-dialog-message'"
      >
        <div class="modal-head">
          <div>
            <h3 v-if="state.title" id="app-dialog-title">{{ state.title }}</h3>
            <div id="app-dialog-message" class="app-dialog-message">
              <p v-for="(line, index) in lines" :key="index">
                {{ line || '\u00A0' }}
              </p>
            </div>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="cancel">
            ×
          </button>
        </div>

        <label v-if="state.password" class="field app-dialog-password">
          <span>Mật khẩu</span>
          <input
            ref="passwordInput"
            v-model="state.passwordValue"
            type="password"
            autocomplete="current-password"
            placeholder="Nhập mật khẩu hiện tại"
            @input="state.passwordError = ''"
          />
          <span v-if="state.passwordError" class="app-dialog-password-error">
            {{ state.passwordError }}
          </span>
        </label>

        <div class="modal-actions">
          <button
            v-if="showCancel"
            class="btn btn--ghost"
            type="button"
            @click="cancel"
          >
            {{ state.cancelText }}
          </button>
          <button
            class="btn btn--primary btn--inline"
            type="button"
            :class="{ 'btn--danger-solid': state.danger }"
            @click="onConfirm"
          >
            {{ state.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
