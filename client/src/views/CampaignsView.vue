<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ClipboardCheck, FileSpreadsheet, Plus, Trash2 } from '@lucide/vue';
import { api } from '../api';
import { confirmDialog } from '../composables/useDialog';
import { useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Đang chạy' },
  { value: 'paused', label: 'Tạm dừng' },
  { value: 'done', label: 'Xong' },
];

const { token, isStaff } = useAuth();
const campaigns = ref([]);
const loading = ref(true);
const error = ref('');
const actionMsg = ref('');
const actionError = ref('');

const showCreateModal = ref(false);
const createForm = reactive({
  name: '',
  status: 'active',
  note: '',
});
const createError = ref('');
const createOk = ref('');
const createBusy = ref(false);

const showDetailModal = ref(false);
const detail = ref(null);
const detailLoading = ref(false);
const detailTab = ref('phones');
const phoneSearch = ref('');
const phoneUsedFilter = ref('all');
const phoneAddedOn = ref('');
const phoneAddedDates = ref([]);
const phonePage = ref(1);
const PHONE_LIMIT_PRESETS = [100, 200, 500, 1000];
const phonePageSize = ref(100);
const phoneLimitChoice = ref('100');
const customPhoneLimit = ref(100);
const phoneTotal = ref(0);
const phoneRows = ref([]);
const selectedPhoneIds = ref([]);
const selectedPhoneById = ref({});
const phonesLoading = ref(false);
const stepBatches = ref([]);
const stepsLoading = ref(false);
const removeBusyId = ref(null);
const useBusyId = ref(null);
const undoBusyStep = ref('');
const exportBusy = ref(false);
const exportProgress = ref(0);
const exportLabel = ref('');
let phoneSearchTimer = null;
let phonesLoadSeq = 0;
let exportSeq = 0;

const EXPORT_PAGE_SIZE = 200;

function statusLabel(value) {
  return STATUS_OPTIONS.find((s) => s.value === value)?.label || value || '—';
}

function formatDayOption(value) {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) return value || '—';
  return `${day}/${month}/${year}`;
}

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function shortStep(step) {
  const value = String(step || '');
  if (value.length <= 10) return value || '—';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const unusedPhoneCount = computed(() =>
  typeof detail.value?.unusedCount === 'number'
    ? detail.value.unusedCount
    : 0
);

const selectedPhoneCount = computed(() => selectedPhoneIds.value.length);

const pageAllSelected = computed(
  () =>
    phoneRows.value.length > 0 &&
    phoneRows.value.every((row) => selectedPhoneIds.value.includes(row.id))
);

const phoneTotalPages = computed(() =>
  Math.max(1, Math.ceil((phoneTotal.value || 0) / phonePageSize.value) || 1)
);

const phonePageNumbers = computed(() => {
  const current = phonePage.value;
  const last = phoneTotalPages.value;
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  let end = Math.min(last, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = [];
  for (let i = start; i <= end; i += 1) pages.push(i);
  return pages;
});

function buildPhonesQuery(overrides = {}) {
  const params = new URLSearchParams();
  const limit = overrides.limit != null ? overrides.limit : phonePageSize.value;
  const offset =
    overrides.offset != null ? overrides.offset : (phonePage.value - 1) * phonePageSize.value;
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('used', phoneUsedFilter.value || 'all');
  const q = String(phoneSearch.value || '').trim();
  if (q) params.set('q', q);
  if (phoneAddedOn.value) params.set('addedOn', phoneAddedOn.value);
  return params.toString();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelCell(value, type = 'String') {
  if (value == null || value === '') {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (type === 'Number' && Number.isFinite(Number(value))) {
    return `<Cell><Data ss:Type="Number">${Number(value)}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function buildCampaignExcelXml(rows, campaignName) {
  const headers = [
    'STT',
    'SĐT',
    'Tên FB',
    'Trạng thái',
    'Nhóm',
    'Đợt thêm',
    'Thêm lúc',
    'Link bài',
    'postId',
    'Ghi chú',
  ];
  const headerRow = `<Row>${headers.map((h) => excelCell(h)).join('')}</Row>`;
  const bodyRows = rows
    .map((p, index) => {
      const cells = [
        excelCell(index + 1, 'Number'),
        excelCell(p.phone),
        excelCell(p.userName || ''),
        excelCell(p.isUsed ? 'Đã dùng' : 'Chưa dùng'),
        excelCell(p.groupName || ''),
        excelCell(p.stepAdd || ''),
        excelCell(formatDate(p.created_at)),
        excelCell(p.postUrl || ''),
        excelCell(p.postId || ''),
        excelCell(p.note || ''),
      ];
      return `<Row>${cells.join('')}</Row>`;
    })
    .join('');

  const sheetName = escapeXml(String(campaignName || 'SDT').slice(0, 31) || 'SDT');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>${escapeXml(campaignName || 'Chiến dịch')}</Title>
 </DocumentProperties>
 <Worksheet ss:Name="${sheetName}">
  <Table>
   ${headerRow}
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFileName(name) {
  return String(name || 'chien-dich')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'chien-dich';
}

function normalizePhoneLimit(value) {
  let limit = Math.floor(Number(value));
  if (!Number.isFinite(limit) || limit < 1) limit = 100;
  if (limit > 10000) limit = 10000;
  return limit;
}

function applyPhonePageSize(value) {
  const next = normalizePhoneLimit(value);
  const unchanged = next === phonePageSize.value && phonePage.value === 1;
  phonePageSize.value = next;
  if (PHONE_LIMIT_PRESETS.includes(next)) {
    phoneLimitChoice.value = String(next);
  } else {
    phoneLimitChoice.value = 'custom';
    customPhoneLimit.value = next;
  }
  if (unchanged) return;
  phonePage.value = 1;
  loadCampaignPhones();
}

function onPhoneLimitChoice() {
  if (phoneLimitChoice.value === 'custom') {
    customPhoneLimit.value = phonePageSize.value;
    return;
  }
  applyPhonePageSize(phoneLimitChoice.value);
}

function applyCustomPhoneLimit() {
  applyPhonePageSize(customPhoneLimit.value);
}

function clearPhoneSelection() {
  selectedPhoneIds.value = [];
  selectedPhoneById.value = {};
}

function isPhoneSelected(id) {
  return selectedPhoneIds.value.includes(id);
}

function togglePhoneSelected(row, checked) {
  const id = row?.id;
  if (id == null) return;
  if (checked) {
    if (!selectedPhoneIds.value.includes(id)) {
      selectedPhoneIds.value = [...selectedPhoneIds.value, id];
    }
    selectedPhoneById.value = { ...selectedPhoneById.value, [id]: row };
    return;
  }
  selectedPhoneIds.value = selectedPhoneIds.value.filter((item) => item !== id);
  const next = { ...selectedPhoneById.value };
  delete next[id];
  selectedPhoneById.value = next;
}

function togglePageSelection(checked) {
  if (checked) {
    const ids = new Set(selectedPhoneIds.value);
    const map = { ...selectedPhoneById.value };
    for (const row of phoneRows.value) {
      if (row?.id == null) continue;
      ids.add(row.id);
      map[row.id] = row;
    }
    selectedPhoneIds.value = Array.from(ids);
    selectedPhoneById.value = map;
    return;
  }
  const pageIds = new Set(phoneRows.value.map((row) => row.id));
  selectedPhoneIds.value = selectedPhoneIds.value.filter((id) => !pageIds.has(id));
  const map = { ...selectedPhoneById.value };
  for (const id of pageIds) delete map[id];
  selectedPhoneById.value = map;
}

async function exportCampaignExcel() {
  if (!detail.value?.id || exportBusy.value) return;

  const picked = selectedPhoneIds.value
    .map((id) => selectedPhoneById.value[id])
    .filter(Boolean);
  const exportSelected = picked.length > 0;

  const markAsUsed = await confirmDialog({
    title: 'Xuất Excel',
    message: exportSelected
      ? `Xuất ${picked.length} SĐT đã chọn. Bạn có muốn đánh dấu đã lấy không?`
      : 'Xuất toàn bộ theo bộ lọc hiện tại. Bạn có muốn đánh dấu đã lấy không?',
    confirmText: 'Có, đánh dấu',
    cancelText: 'Không',
  });

  const seq = ++exportSeq;
  exportBusy.value = true;
  exportProgress.value = 0;
  exportLabel.value = 'Đang chuẩn bị…';
  actionError.value = '';
  actionMsg.value = '';

  try {
    const all = [];
    if (exportSelected) {
      all.push(...picked);
      exportProgress.value = 80;
      exportLabel.value = `Đang xuất ${all.length} SĐT đã chọn…`;
    } else {
      let offset = 0;
      let total = null;

      while (true) {
        if (seq !== exportSeq) return;
        const data = await api(
          `/api/campaigns/${detail.value.id}/phones?${buildPhonesQuery({
            limit: EXPORT_PAGE_SIZE,
            offset,
          })}`,
          { token: token.value }
        );
        if (seq !== exportSeq) return;

        const chunk = data.phones || [];
        total = Number(data.total);
        if (!Number.isFinite(total) || total < 0) total = all.length + chunk.length;
        all.push(...chunk);

        const done = Math.min(all.length, total || all.length);
        exportProgress.value =
          total > 0 ? Math.min(90, Math.round((done / total) * 90)) : 50;
        exportLabel.value = `Đang tải ${done}/${total || '?'} SĐT…`;

        if (!chunk.length || all.length >= total) break;
        offset += EXPORT_PAGE_SIZE;
      }
    }

    if (!all.length) {
      actionError.value = exportSelected
        ? 'Không có SĐT đã chọn để xuất.'
        : 'Không có SĐT để xuất (theo bộ lọc hiện tại).';
      return;
    }

    exportLabel.value = 'Đang tạo file Excel…';
    exportProgress.value = 94;
    const xml = buildCampaignExcelXml(all, detail.value.name);
    const blob = new Blob([xml], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `${safeFileName(detail.value.name)}_${stamp}.xls`;
    downloadBlob(filename, blob);

    let marked = 0;
    if (markAsUsed) {
      const unusedIds = all.filter((p) => !p.isUsed && p.id).map((p) => p.id);
      if (unusedIds.length) {
        exportLabel.value = `Đang đánh dấu đã lấy ${unusedIds.length} SĐT…`;
        exportProgress.value = 97;
        const markData = await api(`/api/campaigns/${detail.value.id}/phones/mark-used`, {
          method: 'POST',
          token: token.value,
          body: { ids: unusedIds },
        });
        marked = Number(markData.updated) || 0;
        if (markData.campaign) {
          detail.value = {
            ...detail.value,
            ...markData.campaign,
          };
          syncCampaignCount(
            detail.value.id,
            markData.campaign.phoneCount,
            markData.campaign.unusedCount
          );
        }
        await loadCampaignPhones();
      }
    }

    exportProgress.value = 100;
    exportLabel.value = `Đã xuất ${all.length} SĐT`;
    try {
      await api('/api/activity/excel', {
        method: 'POST',
        token: token.value,
        body: {
          campaignId: detail.value.id,
          campaignName: detail.value.name,
          count: all.length,
          marked,
          selected: exportSelected,
          filename,
          phones: all.slice(0, 300).map((row) => ({
            phone: row.phone,
            userName: row.userName || '',
            groupName: row.groupName || '',
            isUsed: Boolean(row.isUsed) || markAsUsed,
          })),
        },
      });
    } catch {
      /* lịch sử không chặn file đã tải */
    }
    actionMsg.value = marked
      ? `Đã xuất Excel · ${all.length} SĐT · đánh dấu đã lấy ${marked}`
      : `Đã xuất Excel · ${all.length} SĐT`;
  } catch (err) {
    if (seq !== exportSeq) return;
    actionError.value = err.message || 'Không xuất được Excel';
    exportLabel.value = '';
  } finally {
    if (seq === exportSeq) {
      exportBusy.value = false;
      setTimeout(() => {
        if (seq === exportSeq) {
          exportProgress.value = 0;
          exportLabel.value = '';
        }
      }, 1800);
    }
  }
}

async function loadCampaignPhones() {
  if (!detail.value?.id) return;
  const seq = ++phonesLoadSeq;
  phonesLoading.value = true;
  try {
    const data = await api(
      `/api/campaigns/${detail.value.id}/phones?${buildPhonesQuery()}`,
      { token: token.value }
    );
    if (seq !== phonesLoadSeq) return;
    phoneRows.value = data.phones || [];
    phoneTotal.value = Number(data.total) || 0;
    phoneAddedDates.value = Array.isArray(data.addedDates) ? data.addedDates : [];
    if (phoneAddedOn.value && !phoneAddedDates.value.includes(phoneAddedOn.value)) {
      phoneAddedOn.value = '';
    }
    if (data.campaign) {
      detail.value = {
        ...detail.value,
        ...data.campaign,
        phones: phoneRows.value,
      };
      syncCampaignCount(
        detail.value.id,
        data.campaign.phoneCount,
        data.campaign.unusedCount
      );
    }
    const maxPage = Math.max(1, Math.ceil(phoneTotal.value / phonePageSize.value) || 1);
    if (phonePage.value > maxPage) {
      phonePage.value = maxPage;
      await loadCampaignPhones();
    }
  } catch (err) {
    if (seq !== phonesLoadSeq) return;
    actionError.value = err.message || 'Không tải được danh sách SĐT';
    phoneRows.value = [];
    phoneTotal.value = 0;
  } finally {
    if (seq === phonesLoadSeq) phonesLoading.value = false;
  }
}

async function loadCampaignSteps() {
  if (!detail.value?.id) return;
  stepsLoading.value = true;
  try {
    const data = await api(`/api/campaigns/${detail.value.id}/steps`, {
      token: token.value,
    });
    stepBatches.value = data.steps || [];
  } catch (err) {
    actionError.value = err.message || 'Không tải được lịch sử thêm';
    stepBatches.value = [];
  } finally {
    stepsLoading.value = false;
  }
}

function goToPhonePage(next) {
  const target = Math.min(Math.max(1, next), phoneTotalPages.value);
  if (target === phonePage.value) return;
  phonePage.value = target;
  loadCampaignPhones();
}

function syncCampaignCount(campaignId, phoneCount, unusedCount) {
  campaigns.value = campaigns.value.map((c) =>
    c.id === campaignId
      ? {
          ...c,
          phoneCount,
          ...(typeof unusedCount === 'number' ? { unusedCount } : {}),
        }
      : c
  );
}

async function loadCampaigns() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api('/api/campaigns', { token: token.value });
    campaigns.value = data.campaigns || [];
  } catch (err) {
    error.value = err.message || 'Không tải được chiến dịch';
  } finally {
    loading.value = false;
  }
}

async function openDetailModal(campaign) {
  actionMsg.value = '';
  actionError.value = '';
  phoneSearch.value = '';
  phoneUsedFilter.value = 'all';
  detailLoading.value = true;
  phoneAddedOn.value = '';
  phoneAddedDates.value = [];
  phonePage.value = 1;
  phoneRows.value = [];
  phoneTotal.value = 0;
  clearPhoneSelection();
  stepBatches.value = [];
  detailTab.value = 'phones';
  showDetailModal.value = true;
  detail.value = { id: campaign.id, name: campaign.name, status: campaign.status };
  try {
    const data = await api(`/api/campaigns/${campaign.id}`, { token: token.value });
    detail.value = data.campaign || detail.value;
    if (detail.value) {
      syncCampaignCount(
        detail.value.id,
        detail.value.phoneCount,
        detail.value.unusedCount
      );
    }
    await loadCampaignPhones();
  } catch (err) {
    actionError.value = err.message || 'Không tải được chi tiết chiến dịch';
  } finally {
    detailLoading.value = false;
  }
}

function closeDetailModal() {
  if (removeBusyId.value || useBusyId.value || undoBusyStep.value || exportBusy.value) return;
  exportSeq += 1;
  exportProgress.value = 0;
  exportLabel.value = '';
  showDetailModal.value = false;
  detail.value = null;
  phoneSearch.value = '';
  phoneUsedFilter.value = 'all';
  phoneAddedOn.value = '';
  phoneAddedDates.value = [];
  phonePage.value = 1;
  phoneRows.value = [];
  phoneTotal.value = 0;
  clearPhoneSelection();
  stepBatches.value = [];
}

watch(phoneSearch, () => {
  clearTimeout(phoneSearchTimer);
  phoneSearchTimer = setTimeout(() => {
    phonePage.value = 1;
    loadCampaignPhones();
  }, 300);
});

watch(phoneUsedFilter, () => {
  phonePage.value = 1;
  loadCampaignPhones();
});

watch(phoneAddedOn, () => {
  if (!showDetailModal.value || !detail.value?.id || detailLoading.value) return;
  phonePage.value = 1;
  loadCampaignPhones();
});

watch(detailTab, (tab) => {
  if (tab === 'history' && detail.value?.id && !stepBatches.value.length) {
    loadCampaignSteps();
  }
});

async function copyText(value) {
  const text = String(value || '').trim();
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
}

async function onTakePhone(row) {
  if (!detail.value?.id || !row?.id || row.isUsed) return;
  actionMsg.value = '';
  actionError.value = '';
  useBusyId.value = row.id;
  try {
    const data = await api(`/api/campaigns/${detail.value.id}/phones/${row.id}/use`, {
      method: 'POST',
      token: token.value,
    });
    if (data.campaign) {
      detail.value = { ...detail.value, ...data.campaign };
      syncCampaignCount(
        detail.value.id,
        data.campaign.phoneCount,
        data.campaign.unusedCount
      );
    }
    phoneRows.value = phoneRows.value.map((p) =>
      p.id === row.id ? { ...p, isUsed: true } : p
    );
    await copyText(row.phone);
    actionMsg.value = `Đã lấy ${row.phone} · đã copy`;
  } catch (err) {
    actionError.value = err.message || 'Không lấy được SĐT';
  } finally {
    useBusyId.value = null;
  }
}

function openCreateModal() {
  createError.value = '';
  createOk.value = '';
  createForm.name = '';
  createForm.status = 'active';
  createForm.note = '';
  showCreateModal.value = true;
}

function closeCreateModal() {
  if (createBusy.value) return;
  showCreateModal.value = false;
}

async function onCreateCampaign() {
  createError.value = '';
  createOk.value = '';
  createBusy.value = true;
  try {
    const data = await api('/api/campaigns', {
      method: 'POST',
      token: token.value,
      body: {
        name: createForm.name.trim(),
        status: createForm.status,
        note: createForm.note.trim(),
      },
    });
    if (data.campaign) {
      campaigns.value = [data.campaign, ...campaigns.value];
    } else {
      await loadCampaigns();
    }
    createOk.value = 'Đã tạo chiến dịch';
    setTimeout(() => {
      showCreateModal.value = false;
      createOk.value = '';
    }, 600);
  } catch (err) {
    createError.value = err.message || 'Không tạo được chiến dịch';
  } finally {
    createBusy.value = false;
  }
}

async function onRemovePhone(row) {
  if (!detail.value?.id || !row?.id) return;
  const ok = await confirmDialog({
    title: 'Xóa SĐT',
    message: `Xóa SĐT ${row.phone} khỏi chiến dịch?`,
    confirmText: 'Xóa',
    danger: true,
  });
  if (!ok) return;

  actionMsg.value = '';
  actionError.value = '';
  removeBusyId.value = row.id;
  try {
    const data = await api(`/api/campaigns/${detail.value.id}/phones/${row.id}`, {
      method: 'DELETE',
      token: token.value,
    });
    if (data.campaign) {
      detail.value = { ...detail.value, ...data.campaign };
      syncCampaignCount(
        detail.value.id,
        data.campaign.phoneCount,
        data.campaign.unusedCount
      );
    }
    actionMsg.value = `Đã xóa ${row.phone}`;
    await loadCampaignPhones();
    if (detailTab.value === 'history') await loadCampaignSteps();
  } catch (err) {
    actionError.value = err.message || 'Không xóa được SĐT';
  } finally {
    removeBusyId.value = null;
  }
}

async function onUndoStep(stepAdd) {
  if (!detail.value?.id || !stepAdd) return;
  const ok = await confirmDialog({
    title: 'Hoàn tác đợt thêm',
    message: 'Hoàn tác cả đợt này? Các SĐT cùng step_add sẽ bị xóa khỏi chiến dịch.',
    confirmText: 'Hoàn tác',
    danger: true,
  });
  if (!ok) return;

  actionMsg.value = '';
  actionError.value = '';
  undoBusyStep.value = stepAdd;
  try {
    const data = await api(
      `/api/campaigns/${detail.value.id}/steps/${encodeURIComponent(stepAdd)}`,
      {
        method: 'DELETE',
        token: token.value,
      }
    );
    if (data.campaign) {
      detail.value = { ...detail.value, ...data.campaign };
      syncCampaignCount(
        detail.value.id,
        data.campaign.phoneCount,
        data.campaign.unusedCount
      );
    }
    await loadCampaignPhones();
    await loadCampaignSteps();
    actionMsg.value = `Đã hoàn tác ${data.removed || 0} SĐT`;
  } catch (err) {
    actionError.value = err.message || 'Không hoàn tác được đợt thêm';
  } finally {
    undoBusyStep.value = '';
  }
}

watch([showCreateModal, showDetailModal], ([createOpen, detailOpen]) => {
  document.body.style.overflow = createOpen || detailOpen ? 'hidden' : '';
});

onMounted(async () => {
  await loadCampaigns();
});
</script>

<template>
  <section class="users-panel campaign-page">
    <div class="panel-head panel-head--actions">
      <div>
        <h3>Chiến dịch</h3>
        <p>{{ campaigns.length }} chiến dịch · click để xem chi tiết</p>
      </div>
      <button
        v-if="isStaff"
        class="btn btn--primary btn--inline"
        type="button"
        @click="openCreateModal"
      >
        <Plus class="btn__icon" aria-hidden="true" />
        Tạo chiến dịch
      </button>
    </div>

    <div v-if="error" class="alert alert--error">{{ error }}</div>

    <LoadingState v-if="loading && !campaigns.length" label="Đang tải chiến dịch…" />

    <div
      v-else
      class="panel-loading-wrap table-wrap campaign-list-full"
      :class="{ 'is-loading': loading }"
    >
      <LoadingState v-if="loading" overlay label="Đang tải…" />
      <table class="user-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Tên</th>
            <th>Trạng thái</th>
            <th>SĐT</th>
            <th>Ngày tạo</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in campaigns"
            :key="c.id"
            class="campaign-row"
            tabindex="0"
            @click="openDetailModal(c)"
            @keydown.enter.prevent="openDetailModal(c)"
          >
            <td class="mono">{{ c.id }}</td>
            <td><strong>{{ c.name }}</strong></td>
            <td>
              <span
                :class="`tag tag--status-${c.status === 'active' ? 'active' : c.status === 'done' ? 'done' : 'paused'}`"
              >
                {{ statusLabel(c.status) }}
              </span>
            </td>
            <td>
              <span class="phone-count-btn" :title="`${c.unusedCount ?? 0} chưa dùng`">
                {{ c.unusedCount ?? 0 }}/{{ c.phoneCount || 0 }}
              </span>
            </td>
            <td class="muted">{{ formatDate(c.created_at) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!campaigns.length" class="empty">Chưa có chiến dịch nào.</p>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="showDetailModal"
      class="modal-overlay fade-in"
      @click.self="closeDetailModal"
    >
      <div
        class="modal-card modal-card--wide slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-detail-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="campaign-detail-title">
              {{ detail?.name || 'Chi tiết chiến dịch' }}
            </h3>
            <p>
              {{ detail?.phones?.length || 0 }} SĐT
              · {{ unusedPhoneCount }} chưa dùng
              <span v-if="detail">
                · {{ statusLabel(detail.status) }}
              </span>
              <span v-if="detail?.note"> · {{ detail.note }}</span>
            </p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closeDetailModal">
            ×
          </button>
        </div>

        <div v-if="actionError" class="alert alert--error">{{ actionError }}</div>
        <div v-if="actionMsg" class="alert alert--ok">{{ actionMsg }}</div>
        <LoadingState v-if="detailLoading" compact label="Đang tải chi tiết…" />

        <template v-else-if="detail">
          <div class="view-tabs campaign-detail-tabs" role="tablist" aria-label="Chi tiết chiến dịch">
            <button
              type="button"
              class="view-tab"
              role="tab"
              :aria-selected="detailTab === 'phones'"
              :class="{ active: detailTab === 'phones' }"
              @click="detailTab = 'phones'"
            >
              Danh sách SĐT ({{ detail.phoneCount || phoneTotal || 0 }})
            </button>
            <button
              type="button"
              class="view-tab"
              role="tab"
              :aria-selected="detailTab === 'history'"
              :class="{ active: detailTab === 'history' }"
              @click="detailTab = 'history'"
            >
              Lịch sử thêm ({{ stepBatches.length }})
            </button>
          </div>

          <div v-show="detailTab === 'phones'">
            <div class="campaign-phone-toolbar">
              <div class="campaign-phone-filters">
              <label class="search-box">
                <span class="sr-only">Lọc SĐT</span>
                <input
                  v-model="phoneSearch"
                  type="search"
                  placeholder="Lọc SĐT / tên / step_add…"
                  :disabled="exportBusy"
                />
              </label>
              <select
                v-model="phoneUsedFilter"
                class="limit-select-inline"
                aria-label="Lọc đã dùng"
                :disabled="exportBusy"
              >
                <option value="all">Tất cả</option>
                <option value="unused">Chưa dùng</option>
                <option value="used">Đã dùng</option>
              </select>
              <select
                v-model="phoneAddedOn"
                class="limit-select-inline"
                aria-label="Lọc theo ngày thêm"
                :disabled="exportBusy || !phoneAddedDates.length"
              >
                <option value="">Tất cả ngày</option>
                <option v-for="day in phoneAddedDates" :key="day" :value="day">
                  {{ formatDayOption(day) }}
                </option>
              </select>
              <label class="limit-select">
                <span>Limit</span>
                <select
                  v-model="phoneLimitChoice"
                  aria-label="Số SĐT mỗi trang"
                  :disabled="exportBusy || phonesLoading"
                  @change="onPhoneLimitChoice"
                >
                  <option v-for="n in PHONE_LIMIT_PRESETS" :key="n" :value="String(n)">
                    {{ n }}
                  </option>
                  <option value="custom">Nhập số</option>
                </select>
              </label>
              <form
                v-if="phoneLimitChoice === 'custom'"
                class="campaign-limit-custom"
                @submit.prevent="applyCustomPhoneLimit"
              >
                <input
                  v-model.number="customPhoneLimit"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  aria-label="Số dòng mỗi trang"
                  :disabled="exportBusy || phonesLoading"
                />
                <button
                  class="btn btn--ghost btn--tiny"
                  type="submit"
                  :disabled="exportBusy || phonesLoading"
                >
                  Áp dụng
                </button>
              </form>
              </div>
              <button
                class="btn btn--primary btn--inline"
                type="button"
                :disabled="exportBusy || (!phoneTotal && !selectedPhoneCount)"
                @click="exportCampaignExcel"
              >
                <FileSpreadsheet class="btn__icon" aria-hidden="true" />
                {{
                  exportBusy
                    ? 'Đang xuất…'
                    : selectedPhoneCount
                      ? `Xuất Excel (${selectedPhoneCount})`
                      : 'Xuất Excel'
                }}
              </button>
            </div>

            <div v-if="exportBusy || exportProgress > 0" class="export-progress" aria-live="polite">
              <div class="export-progress-meta">
                <span>{{ exportLabel || 'Đang xuất…' }}</span>
                <span class="mono">{{ exportProgress }}%</span>
              </div>
              <div class="export-progress-track" role="progressbar" :aria-valuenow="exportProgress" aria-valuemin="0" aria-valuemax="100">
                <div class="export-progress-bar" :style="{ width: `${exportProgress}%` }" />
              </div>
            </div>

            <div class="panel-loading-wrap" :class="{ 'is-loading': phonesLoading }">
              <LoadingState v-if="phonesLoading && !phoneRows.length" compact />
              <LoadingState v-else-if="phonesLoading" overlay />
            <div v-if="phoneRows.length" class="table-wrap modal-table">
              <table class="user-table">
                <thead>
                  <tr>
                    <th class="col-check">
                      <input
                        type="checkbox"
                        :checked="pageAllSelected"
                        :disabled="exportBusy || !phoneRows.length"
                        aria-label="Chọn tất cả trang này"
                        @change="togglePageSelection($event.target.checked)"
                      />
                    </th>
                    <th>STT</th>
                    <th>SĐT</th>
                    <th>Tên FB</th>
                    <th>isUsed</th>
                    <th>Nhóm</th>
                    <th>Đợt thêm</th>
                    <th>Thêm lúc</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(p, index) in phoneRows" :key="p.id">
                    <td class="col-check">
                      <input
                        type="checkbox"
                        :checked="isPhoneSelected(p.id)"
                        :disabled="exportBusy"
                        :aria-label="`Chọn ${p.phone}`"
                        @change="togglePhoneSelected(p, $event.target.checked)"
                      />
                    </td>
                    <td class="mono">{{ (phonePage - 1) * phonePageSize + index + 1 }}</td>
                    <td class="mono table-link-color">{{ p.phone }}</td>
                    <td>{{ p.userName || '—' }}</td>
                    <td>
                      <span :class="p.isUsed ? 'tag tag--status-done' : 'tag tag--status-active'">
                        {{ p.isUsed ? 'Đã dùng' : 'Chưa dùng' }}
                      </span>
                    </td>
                    <td class="cell-clip" :title="p.groupName">{{ p.groupName || '—' }}</td>
                    <td class="mono muted" :title="p.stepAdd">{{ shortStep(p.stepAdd) }}</td>
                    <td class="muted">{{ formatDate(p.created_at) }}</td>
                    <td class="campaign-phone-actions">
                      <button
                        v-if="!p.isUsed"
                        class="btn btn--primary btn--tiny"
                        type="button"
                        :disabled="useBusyId === p.id"
                        @click="onTakePhone(p)"
                      >
                        <ClipboardCheck class="btn__icon" aria-hidden="true" />
                        {{ useBusyId === p.id ? '…' : 'Lấy' }}
                      </button>
                      <button
                        v-if="isStaff"
                        class="btn btn--ghost btn--tiny"
                        type="button"
                        :disabled="removeBusyId === p.id"
                        @click="onRemovePhone(p)"
                      >
                        <Trash2 class="btn__icon" aria-hidden="true" />
                        Xóa
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else-if="!phonesLoading" class="empty">
              {{ detail.phoneCount ? 'Không khớp bộ lọc.' : 'Chưa có SĐT trong chiến dịch này.' }}
            </p>
            </div>

            <div v-if="phoneTotal > 0" class="pagination post-links-pagination">
              <button
                class="btn btn--ghost btn--tiny"
                type="button"
                :disabled="phonesLoading || phonePage <= 1"
                @click="goToPhonePage(phonePage - 1)"
              >
                Trước
              </button>

              <button
                v-if="phonePageNumbers[0] > 1"
                class="page-btn"
                type="button"
                :disabled="phonesLoading"
                @click="goToPhonePage(1)"
              >
                1
              </button>
              <span v-if="phonePageNumbers[0] > 2" class="page-ellipsis">…</span>

              <button
                v-for="n in phonePageNumbers"
                :key="n"
                class="page-btn"
                type="button"
                :class="{ active: n === phonePage }"
                :disabled="phonesLoading"
                @click="goToPhonePage(n)"
              >
                {{ n }}
              </button>

              <span
                v-if="phonePageNumbers[phonePageNumbers.length - 1] < phoneTotalPages - 1"
                class="page-ellipsis"
              >…</span>
              <button
                v-if="phonePageNumbers[phonePageNumbers.length - 1] < phoneTotalPages"
                class="page-btn"
                type="button"
                :disabled="phonesLoading"
                @click="goToPhonePage(phoneTotalPages)"
              >
                {{ phoneTotalPages }}
              </button>

              <button
                class="btn btn--ghost btn--tiny"
                type="button"
                :disabled="phonesLoading || phonePage >= phoneTotalPages"
                @click="goToPhonePage(phonePage + 1)"
              >
                Sau
              </button>

              <span class="muted page-meta">
                Trang {{ phonePage }}/{{ phoneTotalPages }}
                · {{ phoneTotal }} SĐT
                · {{ phonePageSize }}/trang
              </span>
            </div>
          </div>

          <div v-show="detailTab === 'history'">
            <LoadingState v-if="stepsLoading && !stepBatches.length" compact />
            <div v-else-if="stepBatches.length" class="campaign-history-list">
              <article
                v-for="batch in stepBatches"
                :key="batch.label"
                class="campaign-history-card"
              >
                <div class="campaign-history-head">
                  <div>
                    <strong>{{ batch.count }} SĐT</strong>
                    <p class="muted">{{ formatDate(batch.createdAt) }}</p>
                  </div>
                  <button
                    v-if="isStaff && batch.canUndo"
                    class="btn btn--ghost btn--inline"
                    type="button"
                    :disabled="undoBusyStep === batch.stepAdd"
                    @click="onUndoStep(batch.stepAdd)"
                  >
                    {{ undoBusyStep === batch.stepAdd ? 'Đang hoàn tác…' : 'Hoàn tác đợt' }}
                  </button>
                </div>

                <p class="campaign-history-step">
                  <span class="muted">step_add</span>
                  <code class="mono">{{ batch.stepAdd || '—' }}</code>
                </p>

                <p v-if="batch.userNames.length" class="muted">
                  Tên: {{ batch.userNames.slice(0, 4).join(', ') }}
                  <span v-if="batch.userNames.length > 4">…</span>
                </p>

                <p class="mono campaign-history-phones">
                  {{ batch.previewPhones.join(', ') }}
                  <span v-if="batch.count > batch.previewPhones.length" class="muted">
                    · +{{ batch.count - batch.previewPhones.length }}
                  </span>
                </p>
              </article>
            </div>
            <p v-else-if="!stepsLoading" class="empty">Chưa có lịch sử thêm SĐT.</p>
          </div>
        </template>

        <div class="modal-actions">
          <button class="btn btn--ghost" type="button" :disabled="exportBusy" @click="closeDetailModal">
            Đóng
          </button>
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
      <div
        class="modal-card slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-create-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="campaign-create-title">Tạo chiến dịch</h3>
            <p>Chỉ admin mới có quyền này</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closeCreateModal">
            ×
          </button>
        </div>

        <form @submit.prevent="onCreateCampaign">
          <div v-if="createError" class="alert alert--error">{{ createError }}</div>
          <div v-if="createOk" class="alert alert--ok">{{ createOk }}</div>

          <div class="field">
            <label for="campaign-name">Tên chiến dịch</label>
            <input
              id="campaign-name"
              v-model="createForm.name"
              placeholder="vd: Quét tháng 10"
              required
              autofocus
            />
          </div>
          <div class="field">
            <label for="campaign-status">Trạng thái</label>
            <select id="campaign-status" v-model="createForm.status">
              <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="campaign-note">Ghi chú</label>
            <input id="campaign-note" v-model="createForm.note" placeholder="Tuỳ chọn" />
          </div>

          <div class="modal-actions">
            <button class="btn btn--ghost" type="button" @click="closeCreateModal">Hủy</button>
            <button class="btn btn--primary btn--inline" type="submit" :disabled="createBusy">
              <span v-if="createBusy" class="spinner spinner--sm" aria-hidden="true" />
              {{ createBusy ? 'Đang tạo…' : 'Tạo chiến dịch' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
