import { reactive } from 'vue';

const state = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: 'Đồng ý',
  cancelText: 'Hủy',
  danger: false,
  password: false,
  passwordValue: '',
  passwordError: '',
  resolve: null,
});

function closeDialog(result) {
  const resolve = state.resolve;
  state.open = false;
  state.resolve = null;
  state.passwordValue = '';
  state.passwordError = '';
  if (typeof resolve === 'function') resolve(result);
}

/**
 * Popup xác nhận thay window.confirm
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options = {}) {
  const message =
    typeof options === 'string' ? options : String(options.message || '');
  const title =
    typeof options === 'string'
      ? 'Xác nhận'
      : String(options.title || 'Xác nhận');

  if (state.open && typeof state.resolve === 'function') {
    state.resolve(false);
  }

  return new Promise((resolve) => {
    state.title = title;
    state.message = message;
    state.confirmText =
      typeof options === 'object' && options.confirmText
        ? String(options.confirmText)
        : 'Đồng ý';
    state.cancelText =
      typeof options === 'object' && options.cancelText
        ? String(options.cancelText)
        : 'Hủy';
    state.danger = Boolean(typeof options === 'object' && options.danger);
    state.password = Boolean(typeof options === 'object' && options.requirePassword);
    state.passwordValue = '';
    state.passwordError = '';
    state.resolve = resolve;
    state.open = true;
  });
}

/**
 * Popup thông báo thay window.alert
 * @returns {Promise<void>}
 */
export function alertDialog(options = {}) {
  const message =
    typeof options === 'string' ? options : String(options.message || '');
  const title =
    typeof options === 'string'
      ? 'Thông báo'
      : String(options.title || 'Thông báo');

  return confirmDialog({
    title,
    message,
    confirmText:
      typeof options === 'object' && options.confirmText
        ? options.confirmText
        : 'Đóng',
    cancelText: '',
    danger: Boolean(typeof options === 'object' && options.danger),
  }).then(() => undefined);
}

export function useDialogState() {
  return {
    state,
    confirm: (value = true) => closeDialog(value),
    cancel: () => closeDialog(false),
  };
}
