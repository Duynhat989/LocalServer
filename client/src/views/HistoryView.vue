<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import { useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const { token } = useAuth();

defineProps({
  embedded: { type: Boolean, default: false },
});

const filters = [
  { id: '', label: 'Tất cả' },
  { id: 'login', label: 'Đăng nhập' },
  { id: 'excel', label: 'Xuất Excel' },
  { id: 'campaign_phone', label: 'Chuyển SĐT' },
  { id: 'filter', label: 'Bộ lọc' },
];

const typeLabels = {
  login: 'Đăng nhập',
  excel: 'Xuất Excel',
  campaign_phone: 'Chuyển SĐT',
  filter: 'Bộ lọc',
};

const activeType = ref('');
const logs = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 40;
const loading = ref(true);
const error = ref('');
const selected = ref(null);

const actionLabels = {
  login: 'Đăng nhập',
  export: 'Xuất file',
  add: 'Thêm vào chiến dịch',
  create: 'Tạo mới',
  update: 'Chỉnh sửa',
};

const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize) || 1));

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function typeLabel(type) {
  return typeLabels[type] || type || '—';
}

function detailLine(row) {
  const detail = row.detail || {};
  if (row.type === 'login' && detail.ip) return detail.ip;
  if (row.type === 'excel' && detail.filename) return detail.filename;
  if (row.type === 'filter' && Array.isArray(detail.keywords) && detail.keywords.length) {
    return detail.keywords.join(' · ');
  }
  const phones = phoneItems(detail);
  if (phones.length) {
    const shown = phones.slice(0, 4).map((item) => item.phone).join(', ');
    return phones.length > 4 ? `${shown}…` : shown;
  }
  return '';
}

function phoneItems(detail) {
  const list = detail?.phones;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === 'string') return { phone: item, userName: '', groupName: '' };
      return {
        phone: item?.phone || '',
        userName: item?.userName || '',
        groupName: item?.groupName || '',
        isUsed: item?.isUsed,
      };
    })
    .filter((item) => item.phone);
}

function factRows(row) {
  const detail = row?.detail || {};
  const facts = [
    ['Thời gian', formatDate(row.created_at)],
    ['Người dùng', row.username || '—'],
    ['Loại', typeLabel(row.type)],
    ['Thao tác', actionLabels[row.action] || row.action || '—'],
  ];
  if (row.type === 'login' && detail.ip) facts.push(['Địa chỉ', detail.ip]);
  if (detail.campaignName) facts.push(['Chiến dịch', detail.campaignName]);
  if (detail.filename) facts.push(['Tệp', detail.filename]);
  if (detail.count != null) facts.push(['Số dòng', String(detail.count)]);
  if (detail.selected != null) facts.push(['Phạm vi', detail.selected ? 'SĐT đã chọn' : 'Theo bộ lọc']);
  if (detail.marked != null) facts.push(['Đánh dấu đã lấy', String(detail.marked)]);
  if (detail.added != null) facts.push(['Đã thêm', String(detail.added)]);
  if (detail.duplicates != null) facts.push(['Số đã có', String(detail.duplicates)]);
  if (detail.name) facts.push(['Bộ lọc', detail.name]);
  if (detail.previousName) facts.push(['Tên cũ', detail.previousName]);
  if (Array.isArray(detail.keywords) && detail.keywords.length) {
    facts.push(['Từ khóa', detail.keywords.join(', ')]);
  }
  return facts;
}

function openDetail(row) {
  selected.value = row;
}

function closeDetail() {
  selected.value = null;
}

async function loadLogs() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page.value - 1) * pageSize),
    });
    if (activeType.value) params.set('type', activeType.value);
    const data = await api(`/api/activity?${params}`, { token: token.value });
    logs.value = data.logs || [];
    total.value = Number(data.total) || 0;
  } catch (err) {
    logs.value = [];
    total.value = 0;
    error.value = err.message || 'Không tải được lịch sử';
  } finally {
    loading.value = false;
  }
}

function selectType(id) {
  if (activeType.value === id) return;
  activeType.value = id;
  if (page.value !== 1) page.value = 1;
  else loadLogs();
}

watch(page, loadLogs);
watch(selected, (row) => {
  document.body.style.overflow = row ? 'hidden' : '';
});
onMounted(loadLogs);
</script>

<template>
  <section class="users-panel" :class="{ 'users-panel--flat': embedded }">
    <div class="panel-head">
      <h3>Lịch sử</h3>
      <p>Đăng nhập, xuất Excel, chuyển SĐT vào chiến dịch, tạo và sửa bộ lọc.</p>
    </div>

    <div class="view-tabs history-tabs" role="tablist" aria-label="Loại lịch sử">
      <button
        v-for="item in filters"
        :key="item.id || 'all'"
        class="view-tab"
        type="button"
        role="tab"
        :class="{ active: activeType === item.id }"
        :aria-selected="activeType === item.id"
        @click="selectType(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div v-if="error" class="alert alert--error">{{ error }}</div>

    <LoadingState v-if="loading && !logs.length" label="Đang tải lịch sử…" />

    <div
      v-else-if="logs.length"
      class="panel-loading-wrap table-wrap"
      :class="{ 'is-loading': loading }"
    >
      <LoadingState v-if="loading" overlay label="Đang tải…" />
      <table class="user-table history-table">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Người dùng</th>
            <th>Loại</th>
            <th>Nội dung</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in logs"
            :key="row.id"
            class="history-row"
            tabindex="0"
            @click="openDetail(row)"
            @keydown.enter.prevent="openDetail(row)"
          >
            <td class="muted history-time">{{ formatDate(row.created_at) }}</td>
            <td>
              <strong>{{ row.username || '—' }}</strong>
            </td>
            <td>
              <span class="tag tag--role" :class="`tag--history-${row.type}`">
                {{ typeLabel(row.type) }}
              </span>
            </td>
            <td>
              <div>{{ row.summary }}</div>
              <div v-if="detailLine(row)" class="muted history-detail">{{ detailLine(row) }}</div>
            </td>
            <td class="history-open">Chi tiết</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="empty">Chưa có lịch sử.</p>

    <div v-if="total > pageSize" class="pagination history-pagination">
      <button
        class="btn btn--ghost btn--tiny"
        type="button"
        :disabled="loading || page <= 1"
        @click="page -= 1"
      >
        Trước
      </button>
      <span class="muted">Trang {{ page }}/{{ totalPages }} · {{ total }} mục</span>
      <button
        class="btn btn--ghost btn--tiny"
        type="button"
        :disabled="loading || page >= totalPages"
        @click="page += 1"
      >
        Sau
      </button>
    </div>

    <Teleport to="body">
      <div v-if="selected" class="modal-overlay fade-in" @click.self="closeDetail">
        <div
          class="modal-card modal-card--group history-detail-card slide-up"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-detail-title"
        >
          <div class="modal-head">
            <div>
              <h3 id="history-detail-title">{{ typeLabel(selected.type) }}</h3>
              <p>{{ selected.summary }}</p>
            </div>
            <button class="modal-close" type="button" aria-label="Đóng" @click="closeDetail">×</button>
          </div>

          <div class="history-facts">
            <div v-for="[label, value] in factRows(selected)" :key="label">
              <span class="muted">{{ label }}</span>
              <p>{{ value }}</p>
            </div>
          </div>

          <div v-if="phoneItems(selected.detail).length" class="table-wrap history-phone-table">
            <table class="user-table">
              <thead>
                <tr>
                  <th>SĐT</th>
                  <th>Tên</th>
                  <th>Nhóm</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in phoneItems(selected.detail)" :key="`${item.phone}-${index}`">
                  <td class="mono table-link-color">{{ item.phone }}</td>
                  <td>{{ item.userName || '—' }}</td>
                  <td>{{ item.groupName || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p
            v-if="selected.detail?.duplicatePhones?.length"
            class="muted history-dupes"
          >
            Số đã có: {{ selected.detail.duplicatePhones.join(', ') }}
          </p>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="closeDetail">Đóng</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
