<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Filter, FilterX, Megaphone, RefreshCw, Target } from '@lucide/vue';
import { api } from '../api';
import { useAuth } from '../composables/useAuth';
import KeywordFilterFlow from '../components/KeywordFilterFlow.vue';
import LoadingState from '../components/LoadingState.vue';
import {
  getActiveFilterId,
  getActiveFilterPaths,
  formatPathsExpression,
  setActiveFilterId,
} from '../utils/keywordFlow';

const LIMIT_OPTIONS = [100, 200, 500, 1000, 10000];

const route = useRoute();
const router = useRouter();
const { token, isStaff } = useAuth();
const posts = ref([]);
const serverPhoneGroups = ref(null);
const loading = ref(true);
const error = ref('');
const activeTab = ref(route.query.view === 'post' ? 'post' : 'phone');
const groupFilter = ref(String(route.query.groupId || '').trim());
const groups = ref([]);
const phoneFilter = ref('');
const phoneFilterApplied = ref('');
const pushedFrom = ref('');
const pushedTo = ref('');
const selectedPostIds = ref([]);
const selectedPhones = ref([]);
const showKeywordFlow = ref(false);
const keywordPaths = ref([]);
const keywordExpression = ref('');
const activeFilterName = ref('');
const pageLimit = ref(100);
const page = ref(1);
const total = ref(0);
const toastVisible = ref(false);
const toastMessage = ref('');

const showCampaignModal = ref(false);
const campaigns = ref([]);
const campaignsLoading = ref(false);
const selectedCampaignId = ref(null);
const pushBusy = ref(false);
const pushError = ref('');

const showCampaignFilterModal = ref(false);
const campaignFilterId = ref(null);
const campaignFilterMembership = ref(''); // '' | 'in' | 'out'
const campaignFilterName = ref('');
const campaignFilterDraftId = ref(null);
const campaignFilterDraftMembership = ref('out');
const campaignFilterError = ref('');

const showPostLinksModal = ref(false);
const postLinksGroup = ref(null);
const postLinksNameFilter = ref('');
const postLinksPage = ref(1);
const postLinksPageSize = 50;
const postLinksPosts = ref([]);
const postLinksTotal = ref(0);
const postLinksNameOptions = ref([]);
const postLinksLoading = ref(false);
let postLinksLoadSeq = 0;

let phoneDebounceTimer = null;
let toastTimer = null;
let loadSeq = 0;

function normalizePhone(input) {
  return String(input || '')
    .replace(/[^\d+]/g, '')
    .trim();
}

function postKey(p) {
  return String(p.postId || p.id);
}

async function loadSavedKeywordFilter() {
  const activeId = getActiveFilterId();
  if (activeId == null) {
    keywordPaths.value = [];
    keywordExpression.value = '';
    activeFilterName.value = '';
    return;
  }
  try {
    const data = await api('/api/filters', { token: token.value });
    const filters = data.filters || [];
    const paths = getActiveFilterPaths(filters, activeId);
    const active = filters.find((i) => Number(i.id) === Number(activeId));
    if (!active) {
      setActiveFilterId(null);
      keywordPaths.value = [];
      keywordExpression.value = '';
      activeFilterName.value = '';
      return;
    }
    keywordPaths.value = paths;
    keywordExpression.value = formatPathsExpression(paths);
    activeFilterName.value = active.name || '';
  } catch (_) {
    keywordPaths.value = [];
    keywordExpression.value = '';
    activeFilterName.value = '';
  }
}

const uniquePhones = computed(() => {
  const set = new Set();
  for (const p of posts.value) {
    const phone = String(p.phone || '').trim();
    if (phone) set.add(phone);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
});

const groupOptions = computed(() => {
  const map = new Map();
  for (const g of groups.value) {
    const uid = String(g.uid || '').trim();
    if (!uid) continue;
    map.set(uid, {
      uid,
      name: g.name || '',
      label: g.name ? `${g.name} (${uid})` : uid,
    });
  }
  for (const p of posts.value) {
    const uid = String(p.groupId || '').trim();
    if (!uid || map.has(uid)) continue;
    map.set(uid, {
      uid,
      name: p.groupName || '',
      label: p.groupName ? `${p.groupName} (${uid})` : uid,
    });
  }
  if (groupFilter.value && !map.has(groupFilter.value)) {
    map.set(groupFilter.value, {
      uid: groupFilter.value,
      name: '',
      label: groupFilter.value,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
});

const selectedGroupLabel = computed(() => {
  const uid = String(groupFilter.value || '').trim();
  if (!uid) return '';
  const found = groupOptions.value.find((g) => g.uid === uid);
  return found?.label || uid;
});

function latestPostTime(postsList) {
  const times = (postsList || [])
    .map((p) => {
      const raw = p?.created_time || p?.createdTime;
      if (!raw) return null;
      const t = new Date(raw).getTime();
      return Number.isNaN(t) ? null : t;
    })
    .filter((t) => t != null);
  return times.length ? Math.max(...times) : null;
}

function latestScannedTime(postsList) {
  const times = (postsList || [])
    .map((p) => {
      if (p?.scannedAt == null || p.scannedAt === '') return null;
      const n = Number(p.scannedAt);
      if (Number.isFinite(n)) return n;
      const t = new Date(p.scannedAt).getTime();
      return Number.isNaN(t) ? null : t;
    })
    .filter((t) => t != null);
  return times.length ? Math.max(...times) : null;
}

const phoneGroups = computed(() => {
  if (Array.isArray(serverPhoneGroups.value)) {
    return serverPhoneGroups.value.map((group) => ({
      ...group,
      latestTime:
        group.latestTime != null
          ? group.latestTime
          : latestPostTime(group.posts),
      latestScannedAt:
        group.latestScannedAt != null
          ? group.latestScannedAt
          : latestScannedTime(group.posts),
    }));
  }

  const map = new Map();

  for (const post of posts.value) {
    const phone = String(post.phone || '').trim() || 'Không có SĐT';
    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        posts: [],
        userNames: new Set(),
      });
    }
    const group = map.get(phone);
    group.posts.push(post);
    if (post.userName) group.userNames.add(post.userName);
  }

  return Array.from(map.values())
    .map((group) => ({
      phone: group.phone,
      count: group.posts.length,
      userNames: Array.from(group.userNames),
      posts: group.posts,
      latestTime: latestPostTime(group.posts),
      latestScannedAt: latestScannedTime(group.posts),
    }))
    .sort(
      (a, b) =>
        (b.latestScannedAt || 0) - (a.latestScannedAt || 0) ||
        a.phone.localeCompare(b.phone)
    );
});

const allPostsSelected = computed({
  get() {
    const keys = posts.value.map(postKey);
    return keys.length > 0 && keys.every((k) => selectedPostIds.value.includes(k));
  },
  set(value) {
    const keys = posts.value.map(postKey);
    if (value) {
      selectedPostIds.value = Array.from(new Set([...selectedPostIds.value, ...keys]));
    } else {
      selectedPostIds.value = selectedPostIds.value.filter((k) => !keys.includes(k));
    }
  },
});

const allPhonesSelected = computed({
  get() {
    const keys = phoneGroups.value.map((g) => g.phone);
    return keys.length > 0 && keys.every((k) => selectedPhones.value.includes(k));
  },
  set(value) {
    const keys = phoneGroups.value.map((g) => g.phone);
    if (value) {
      selectedPhones.value = Array.from(new Set([...selectedPhones.value, ...keys]));
    } else {
      selectedPhones.value = selectedPhones.value.filter((k) => !keys.includes(k));
    }
  },
});

const hasCampaignFilter = computed(
  () =>
    Boolean(campaignFilterId.value) &&
    (campaignFilterMembership.value === 'in' || campaignFilterMembership.value === 'out')
);

const campaignFilterLabel = computed(() => {
  if (!hasCampaignFilter.value) return '';
  const name = campaignFilterName.value || `CD #${campaignFilterId.value}`;
  const kind =
    campaignFilterMembership.value === 'in' ? 'đã thêm' : 'chưa thêm';
  return `${name} · ${kind}`;
});

const hasActiveFilters = computed(
  () =>
    Boolean(phoneFilterApplied.value.trim()) ||
    Boolean(groupFilter.value.trim()) ||
    Boolean(pushedFrom.value) ||
    Boolean(pushedTo.value) ||
    keywordPaths.value.length > 0 ||
    hasCampaignFilter.value
);

const selectedCount = computed(() =>
  activeTab.value === 'phone' ? selectedPhones.value.length : selectedPostIds.value.length
);

const canPushToCampaign = computed(
  () => isStaff.value && selectedCount.value > 0
);

const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageLimit.value) || 1));

const pageNumbers = computed(() => {
  const current = page.value;
  const last = totalPages.value;
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  let end = Math.min(last, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = [];
  for (let i = start; i <= end; i += 1) pages.push(i);
  return pages;
});

const rangeLabel = computed(() => {
  const unit = activeTab.value === 'phone' ? 'SĐT' : 'bài';
  if (!total.value) return `0 ${unit}`;
  const from = (page.value - 1) * pageLimit.value + 1;
  const to = Math.min(page.value * pageLimit.value, total.value);
  return `${from}–${to} / ${total.value} ${unit}`;
});

function buildQuery() {
  const limit = pageLimit.value;
  const offset = (page.value - 1) * limit;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('view', activeTab.value === 'phone' ? 'phone' : 'post');

  const phone = String(phoneFilterApplied.value || '').trim();
  if (phone) params.set('phone', phone);

  const groupId = String(groupFilter.value || '').trim();
  if (groupId) params.set('groupId', groupId);

  if (pushedFrom.value) params.set('pushedFrom', pushedFrom.value);
  if (pushedTo.value) params.set('pushedTo', pushedTo.value);

  if (keywordPaths.value.length) {
    params.set('paths', JSON.stringify(keywordPaths.value));
  }

  if (hasCampaignFilter.value) {
    params.set('campaignId', String(campaignFilterId.value));
    params.set('campaignMembership', campaignFilterMembership.value);
  }

  return params.toString();
}

function syncRouteQuery() {
  const query = {};
  if (activeTab.value === 'post') query.view = 'post';
  else if (activeTab.value === 'phone') query.view = 'phone';
  const groupId = String(groupFilter.value || '').trim();
  if (groupId) query.groupId = groupId;
  router.replace({ query }).catch(() => {});
}

async function loadPosts() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/api/posts?${buildQuery()}`, {
      token: token.value,
    });
    if (seq !== loadSeq) return;

    posts.value = data.posts || [];
    total.value = Number(data.total) || 0;
    serverPhoneGroups.value =
      data.view === 'phone' && Array.isArray(data.phoneGroups) ? data.phoneGroups : null;

    if (data.limit && LIMIT_OPTIONS.includes(Number(data.limit))) {
      pageLimit.value = Number(data.limit);
    }

    const maxPage = Math.max(1, Math.ceil(total.value / pageLimit.value) || 1);
    if (page.value > maxPage) {
      page.value = maxPage;
      loading.value = false;
      await loadPosts();
      return;
    }

    selectedPostIds.value = [];
    selectedPhones.value = [];
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = err.message || 'Không tải được danh sách post';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function clearListData() {
  posts.value = [];
  serverPhoneGroups.value = null;
  total.value = 0;
  selectedPostIds.value = [];
  selectedPhones.value = [];
}

function reloadFromFirstPage() {
  page.value = 1;
  loadPosts();
}

function goToPage(next) {
  const target = Math.min(Math.max(1, next), totalPages.value);
  if (target === page.value) return;
  page.value = target;
  loadPosts();
}

/** Đổi tab ngay trên UI, rồi mới fetch — tránh cảm giác đơ */
async function switchTab(tab) {
  if (tab !== 'post' && tab !== 'phone') return;
  if (tab === activeTab.value) return;
  activeTab.value = tab;
  page.value = 1;
  loading.value = true;
  error.value = '';
  clearListData();
  syncRouteQuery();
  await nextTick();
  await loadPosts();
}

function onKeywordFlowChange(payload) {
  keywordPaths.value = payload.paths || [];
  keywordExpression.value = payload.expression || '';
  activeFilterName.value = payload.name || '';
  reloadFromFirstPage();
}

function clearFilters() {
  phoneFilter.value = '';
  phoneFilterApplied.value = '';
  groupFilter.value = '';
  pushedFrom.value = '';
  pushedTo.value = '';
  keywordPaths.value = [];
  keywordExpression.value = '';
  activeFilterName.value = '';
  setActiveFilterId(null);
  clearCampaignFilter(false);
  syncRouteQuery();
  reloadFromFirstPage();
}

function clearCampaignFilter(reload = true) {
  campaignFilterId.value = null;
  campaignFilterMembership.value = '';
  campaignFilterName.value = '';
  if (reload) reloadFromFirstPage();
}

async function ensureCampaignsLoaded() {
  if (campaigns.value.length && !campaignsLoading.value) return;
  campaignsLoading.value = true;
  campaignFilterError.value = '';
  try {
    const data = await api('/api/campaigns', { token: token.value });
    campaigns.value = data.campaigns || [];
  } catch (err) {
    campaignFilterError.value = err.message || 'Không tải được chiến dịch';
    campaigns.value = [];
  } finally {
    campaignsLoading.value = false;
  }
}

async function openCampaignFilterModal() {
  campaignFilterError.value = '';
  campaignFilterDraftId.value = campaignFilterId.value;
  campaignFilterDraftMembership.value = campaignFilterMembership.value || 'out';
  showCampaignFilterModal.value = true;
  await ensureCampaignsLoaded();
  if (
    campaignFilterDraftId.value == null &&
    campaigns.value.length === 1
  ) {
    campaignFilterDraftId.value = campaigns.value[0].id;
  }
}

function closeCampaignFilterModal() {
  showCampaignFilterModal.value = false;
  campaignFilterError.value = '';
}

function applyCampaignFilter() {
  const id = Number(campaignFilterDraftId.value);
  const membership = campaignFilterDraftMembership.value;
  if (!Number.isFinite(id) || id <= 0) {
    campaignFilterError.value = 'Chọn chiến dịch trước';
    return;
  }
  if (membership !== 'in' && membership !== 'out') {
    campaignFilterError.value = 'Chọn đã thêm hoặc chưa thêm';
    return;
  }
  const found = campaigns.value.find((c) => c.id === id);
  campaignFilterId.value = id;
  campaignFilterMembership.value = membership;
  campaignFilterName.value = found?.name || `CD #${id}`;
  showCampaignFilterModal.value = false;
  reloadFromFirstPage();
}

function clearGroupFilter() {
  groupFilter.value = '';
  syncRouteQuery();
  reloadFromFirstPage();
}

function onGroupFilterChange() {
  syncRouteQuery();
  reloadFromFirstPage();
}

async function loadGroups() {
  try {
    const data = await api('/api/groups', { token: token.value });
    groups.value = data.groups || [];
  } catch (_) {
    groups.value = [];
  }
}

function truncate(text, max = 80) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function shortPostId(postId) {
  if (!postId) return '—';
  // vd: 1000832851236530_1823547685631705__0364543397 → 1823547685631705
  let value = String(postId);
  const phoneSep = value.indexOf('__');
  if (phoneSep >= 0) value = value.slice(0, phoneSep);
  const parts = value.split('_').filter(Boolean);
  return parts[parts.length - 1] || value || '—';
}

function formatCreatedTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function formatScannedAt(value) {
  if (value == null || value === '') return '—';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function formatLatest(ts) {
  if (ts == null) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${hh}:${mm} ${dd}-${mo}-${yyyy}`;
}

function rowStt(index) {
  return (page.value - 1) * pageLimit.value + index + 1;
}

function showToast(message) {
  toastMessage.value = message;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2200);
}

async function copyPhone(phone) {
  const value = String(phone || '').trim();
  if (!value || value === 'Không có SĐT') return;
  try {
    await navigator.clipboard.writeText(value);
  } catch (_) {
    const input = document.createElement('input');
    input.value = value;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
  showToast(`Đã sao chép ${value}`);
}

function pickSourcePost(groupOrPosts) {
  if (groupOrPosts && !Array.isArray(groupOrPosts) && groupOrPosts.samplePost) {
    return groupOrPosts.samplePost;
  }
  const postsList = Array.isArray(groupOrPosts)
    ? groupOrPosts
    : groupOrPosts?.posts || [];
  if (!postsList.length) return null;
  return [...postsList].sort((a, b) => {
    const ta = a.created_time ? new Date(a.created_time).getTime() : Infinity;
    const tb = b.created_time ? new Date(b.created_time).getTime() : Infinity;
    return ta - tb;
  })[0];
}

function itemFromPost(post, phoneOverride) {
  const phone = normalizePhone(phoneOverride || post?.phone);
  if (!phone) return null;
  return {
    phone,
    postId: post?.postId || null,
    postMessage: post?.postMessage || null,
    postUrl: post?.postUrl || null,
    groupId: post?.groupId || null,
    groupName: post?.groupName || null,
    userId: post?.userId || null,
    userName: post?.userName || null,
    userUrl: post?.userUrl || null,
    thesame: post?.thesame || null,
    created_time: post?.created_time || null,
    scannedAt: post?.scannedAt ?? null,
    keyword: post?.keyword || null,
  };
}

function buildSelectedCampaignItems() {
  const map = new Map();

  if (activeTab.value === 'phone') {
    for (const group of phoneGroups.value) {
      if (!selectedPhones.value.includes(group.phone)) continue;
      const phone = normalizePhone(group.phone);
      if (!phone || map.has(phone)) continue;
      const source = pickSourcePost(group);
      const item = itemFromPost(source, phone);
      if (!item) continue;
      if (group.userNames?.length) {
        item.userName = group.userNames.join(', ');
      }
      map.set(phone, item);
    }
  } else {
    const selected = new Set(selectedPostIds.value);
    for (const post of posts.value) {
      if (!selected.has(postKey(post))) continue;
      const item = itemFromPost(post);
      if (!item || map.has(item.phone)) continue;
      map.set(item.phone, item);
    }
  }

  return Array.from(map.values());
}

const selectedCampaignItems = computed(() => buildSelectedCampaignItems());

async function openCampaignModal() {
  const items = selectedCampaignItems.value;
  if (!items.length) {
    showToast('Không có SĐT hợp lệ để đẩy');
    return;
  }
  pushError.value = '';
  selectedCampaignId.value = null;
  showCampaignModal.value = true;
  campaignsLoading.value = true;
  try {
    const data = await api('/api/campaigns', { token: token.value });
    campaigns.value = data.campaigns || [];
    if (campaigns.value.length === 1) {
      selectedCampaignId.value = campaigns.value[0].id;
    }
  } catch (err) {
    pushError.value = err.message || 'Không tải được chiến dịch';
    campaigns.value = [];
  } finally {
    campaignsLoading.value = false;
  }
}

function closeCampaignModal() {
  if (pushBusy.value) return;
  showCampaignModal.value = false;
  pushError.value = '';
}

async function pushToCampaign() {
  const campaignId = Number(selectedCampaignId.value);
  if (!Number.isFinite(campaignId)) {
    pushError.value = 'Chọn chiến dịch';
    return;
  }
  const items = selectedCampaignItems.value;
  if (!items.length) {
    pushError.value = 'Không có SĐT hợp lệ';
    return;
  }

  pushBusy.value = true;
  pushError.value = '';
  try {
    const data = await api(`/api/campaigns/${campaignId}/phones`, {
      method: 'POST',
      token: token.value,
      body: { items },
    });
    const parts = [];
    if (data.added) parts.push(`Đã thêm ${data.added} SĐT`);
    if (data.duplicates?.length) {
      parts.push(`Trùng bỏ qua: ${data.duplicates.length}`);
    }
    if (data.stepAdd) parts.push(`step_add ${data.stepAdd}`);
    showToast(parts.join(' · ') || 'Không có SĐT mới');
    showCampaignModal.value = false;
    selectedPhones.value = [];
    selectedPostIds.value = [];
  } catch (err) {
    pushError.value = err.message || 'Không đẩy được vào chiến dịch';
  } finally {
    pushBusy.value = false;
  }
}

watch(phoneFilter, (value) => {
  clearTimeout(phoneDebounceTimer);
  phoneDebounceTimer = setTimeout(() => {
    const next = String(value || '').trim();
    if (next === phoneFilterApplied.value) return;
    phoneFilterApplied.value = next;
    reloadFromFirstPage();
  }, 350);
});

watch(pageLimit, () => {
  reloadFromFirstPage();
});

watch([pushedFrom, pushedTo], () => {
  reloadFromFirstPage();
});

watch(
  () => [route.query.groupId, route.query.view],
  async ([groupId, view]) => {
    const nextGroup = String(groupId || '').trim();
    const nextTab = view === 'post' ? 'post' : view === 'phone' ? 'phone' : activeTab.value;
    const groupChanged = nextGroup !== groupFilter.value;
    const tabChanged = nextTab !== activeTab.value;
    if (!groupChanged && !tabChanged) return;

    // Cập nhật UI trước, fetch sau
    groupFilter.value = nextGroup;
    if (tabChanged) activeTab.value = nextTab;
    page.value = 1;
    loading.value = true;
    error.value = '';
    clearListData();
    await nextTick();
    await loadPosts();
  }
);

const postLinksTotalPages = computed(() =>
  Math.max(1, Math.ceil((postLinksTotal.value || 0) / postLinksPageSize) || 1)
);

const postLinksPageItems = computed(() => postLinksPosts.value);

const postLinksPageNumbers = computed(() => {
  const current = postLinksPage.value;
  const last = postLinksTotalPages.value;
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  let end = Math.min(last, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = [];
  for (let i = start; i <= end; i += 1) pages.push(i);
  return pages;
});

function buildPostLinksQuery() {
  const params = new URLSearchParams();
  params.set('view', 'post');
  params.set('limit', String(postLinksPageSize));
  params.set('offset', String((postLinksPage.value - 1) * postLinksPageSize));
  params.set('phoneExact', String(postLinksGroup.value?.phone || ''));

  const groupId = String(groupFilter.value || '').trim();
  if (groupId) params.set('groupId', groupId);
  if (pushedFrom.value) params.set('pushedFrom', pushedFrom.value);
  if (pushedTo.value) params.set('pushedTo', pushedTo.value);
  if (keywordPaths.value.length) {
    params.set('paths', JSON.stringify(keywordPaths.value));
  }
  if (hasCampaignFilter.value) {
    params.set('campaignId', String(campaignFilterId.value));
    params.set('campaignMembership', campaignFilterMembership.value);
  }
  const name = String(postLinksNameFilter.value || '').trim();
  if (name) params.set('userName', name);

  return params.toString();
}

async function loadPostLinks() {
  if (!postLinksGroup.value?.phone) return;
  const seq = ++postLinksLoadSeq;
  postLinksLoading.value = true;
  try {
    const data = await api(`/api/posts?${buildPostLinksQuery()}`, {
      token: token.value,
    });
    if (seq !== postLinksLoadSeq) return;
    postLinksPosts.value = data.posts || [];
    postLinksTotal.value = Number(data.total) || 0;
    if (Array.isArray(data.userNames)) {
      postLinksNameOptions.value = data.userNames;
    }
    const maxPage = Math.max(1, Math.ceil(postLinksTotal.value / postLinksPageSize) || 1);
    if (postLinksPage.value > maxPage) {
      postLinksPage.value = maxPage;
      postLinksLoading.value = false;
      await loadPostLinks();
    }
  } catch (err) {
    if (seq !== postLinksLoadSeq) return;
    postLinksPosts.value = [];
    postLinksTotal.value = 0;
    showToast(err.message || 'Không tải được link bài viết');
  } finally {
    if (seq === postLinksLoadSeq) postLinksLoading.value = false;
  }
}

function openPostLinksModal(group) {
  postLinksGroup.value = {
    phone: group.phone,
    count: group.count || 0,
    userNames: group.userNames || [],
  };
  postLinksNameFilter.value = '';
  postLinksPage.value = 1;
  postLinksPosts.value = [];
  postLinksTotal.value = Number(group.count) || 0;
  postLinksNameOptions.value = Array.isArray(group.userNames) ? [...group.userNames] : [];
  showPostLinksModal.value = true;
  loadPostLinks();
}

function closePostLinksModal() {
  showPostLinksModal.value = false;
  postLinksGroup.value = null;
  postLinksNameFilter.value = '';
  postLinksPage.value = 1;
  postLinksPosts.value = [];
  postLinksTotal.value = 0;
  postLinksNameOptions.value = [];
  postLinksLoadSeq += 1;
}

function goToPostLinksPage(next) {
  const target = Math.min(Math.max(1, next), postLinksTotalPages.value);
  if (target === postLinksPage.value) return;
  postLinksPage.value = target;
  loadPostLinks();
}

watch(postLinksNameFilter, () => {
  if (!showPostLinksModal.value) return;
  postLinksPage.value = 1;
  loadPostLinks();
});

watch(
  [showCampaignModal, showPostLinksModal, showCampaignFilterModal],
  ([campaignOpen, linksOpen, filterOpen]) => {
    document.body.style.overflow =
      campaignOpen || linksOpen || filterOpen ? 'hidden' : '';
  }
);

onMounted(() => {
  phoneFilterApplied.value = String(phoneFilter.value || '').trim();
  // Hiện khung trang ngay; tải phụ trợ song song, không chặn lần load đầu
  loadGroups();
  loadSavedKeywordFilter().finally(() => {
    loadPosts();
  });
});
</script>

<template>
  <section class="users-panel">
    <div class="panel-head panel-head--actions">
      <div>
        <h3>Danh sách bài đăng</h3>
        <p>
          {{ rangeLabel }}
          <span v-if="activeTab === 'post' && selectedPostIds.length">
            · đã chọn {{ selectedPostIds.length }}
          </span>
          <span v-if="activeTab === 'phone' && selectedPhones.length">
            · đã chọn {{ selectedPhones.length }}
          </span>
        </p>
      </div>
      <div class="posts-head-actions">
        <button
          v-if="canPushToCampaign"
          class="btn btn--primary btn--inline"
          type="button"
          @click="openCampaignModal"
        >
          <Megaphone class="btn__icon" aria-hidden="true" />
          Đẩy vào chiến dịch ({{ selectedCount }})
        </button>
        <label class="limit-select">
          <span>Limit</span>
          <select v-model.number="pageLimit">
            <option v-for="n in LIMIT_OPTIONS" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <button class="btn btn--ghost btn--inline" type="button" :disabled="loading" @click="loadPosts">
          <span v-if="loading" class="spinner spinner--sm" aria-hidden="true" />
          <RefreshCw v-else class="btn__icon" aria-hidden="true" />
          {{ loading ? 'Đang tải…' : 'Làm mới' }}
        </button>
      </div>
    </div>

    <div class="posts-control">
      <div class="posts-control__bar">
        <div class="view-tabs" role="tablist" aria-label="Chế độ xem">
          <button
            type="button"
            class="view-tab"
            role="tab"
            :aria-selected="activeTab === 'post'"
            :class="{ active: activeTab === 'post' }"
            @click="switchTab('post')"
          >
            Theo post
          </button>
          <button
            type="button"
            class="view-tab"
            role="tab"
            :aria-selected="activeTab === 'phone'"
            :class="{ active: activeTab === 'phone' }"
            @click="switchTab('phone')"
          >
            Theo phone
          </button>
        </div>

        <div class="posts-filter-actions">
          <button
            class="btn btn--primary btn--inline"
            type="button"
            :class="{ 'is-filter-active': keywordPaths.length }"
            @click="showKeywordFlow = true"
          >
            <Filter class="btn__icon" aria-hidden="true" />
            Lọc từ khóa
            <span v-if="keywordPaths.length" class="filter-badge">{{ keywordPaths.length }}</span>
          </button>
          <button
            class="btn btn--ghost btn--inline"
            type="button"
            :class="{ 'is-filter-active': hasCampaignFilter }"
            @click="openCampaignFilterModal"
          >
            <Target class="btn__icon" aria-hidden="true" />
            Lọc chiến dịch
          </button>
          <button
            v-if="hasActiveFilters"
            class="btn btn--ghost btn--inline"
            type="button"
            @click="clearFilters"
          >
            <FilterX class="btn__icon" aria-hidden="true" />
            Xóa lọc
          </button>
        </div>
      </div>

      <div class="posts-filter-panel">
        <label class="pf-field">
          <span class="sr-only">SĐT</span>
          <input
            v-model="phoneFilter"
            class="pf-field__control"
            type="search"
            list="posts-phone-list"
            placeholder="SĐT…"
          />
          <datalist id="posts-phone-list">
            <option v-for="phone in uniquePhones" :key="phone" :value="phone" />
          </datalist>
        </label>

        <label class="pf-field">
          <span class="sr-only">Nhóm</span>
          <select
            v-model="groupFilter"
            class="pf-field__control"
            aria-label="Lọc theo nhóm"
            @change="onGroupFilterChange"
          >
            <option value="">Tất cả nhóm</option>
            <option v-for="g in groupOptions" :key="g.uid" :value="g.uid">
              {{ g.label }}
            </option>
          </select>
        </label>

        <div class="pf-field pf-field--span">
          <span class="pf-field__label">Quét</span>
          <div class="pf-dates">
            <input
              v-model="pushedFrom"
              class="pf-field__control"
              type="date"
              aria-label="Quét từ ngày"
            />
            <span class="pf-dates__sep" aria-hidden="true">→</span>
            <input
              v-model="pushedTo"
              class="pf-field__control"
              type="date"
              aria-label="Quét đến ngày"
            />
          </div>
        </div>
      </div>

      <div v-if="hasActiveFilters" class="posts-filter-chips">
        <button
          v-if="phoneFilterApplied.trim()"
          class="filter-chip"
          type="button"
          @click="phoneFilter = ''; phoneFilterApplied = ''; reloadFromFirstPage()"
        >
          SĐT: {{ phoneFilterApplied }}
          <span aria-hidden="true">×</span>
        </button>
        <button
          v-if="groupFilter"
          class="filter-chip"
          type="button"
          @click="clearGroupFilter"
        >
          Nhóm: {{ selectedGroupLabel }}
          <span aria-hidden="true">×</span>
        </button>
        <button
          v-if="pushedFrom || pushedTo"
          class="filter-chip"
          type="button"
          @click="pushedFrom = ''; pushedTo = ''"
        >
          Quét:
          {{ pushedFrom || '…' }}
          →
          {{ pushedTo || '…' }}
          <span aria-hidden="true">×</span>
        </button>
        <button
          v-if="hasCampaignFilter"
          class="filter-chip"
          type="button"
          @click="clearCampaignFilter()"
        >
          {{ campaignFilterLabel }}
          <span aria-hidden="true">×</span>
        </button>
        <button
          v-if="keywordExpression"
          class="filter-chip filter-chip--wide"
          type="button"
          @click="showKeywordFlow = true"
        >
          <span v-if="activeFilterName">{{ activeFilterName }} · </span>{{ keywordExpression }}
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert--error">{{ error }}</div>

    <div class="panel-loading-wrap" :class="{ 'is-loading': loading }">
      <LoadingState v-if="loading" :overlay="!!(activeTab === 'phone' ? phoneGroups.length : posts.length)" />

      <template v-if="activeTab === 'phone' ? phoneGroups.length : posts.length">
      <div v-show="activeTab === 'post'" class="table-wrap">
        <table class="user-table posts-table">
          <thead>
            <tr>
              <th class="col-check">
                <input v-model="allPostsSelected" type="checkbox" aria-label="Chọn tất cả bài" />
              </th>
              <th class="col-stt">STT</th>
              <th>postId</th>
              <th>postMessage</th>
              <th>phone</th>
              <th>userName</th>
              <th>groupName</th>
              <th>groupId</th>
              <th>created_time</th>
              <th>scannedAt</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, index) in posts" :key="p.postId || p.id">
              <td class="col-check">
                <input
                  v-model="selectedPostIds"
                  type="checkbox"
                  :value="postKey(p)"
                  :aria-label="`Chọn ${shortPostId(p.postId)}`"
                />
              </td>
              <td class="col-stt mono">{{ rowStt(index) }}</td>
              <td class="mono cell-id">{{ shortPostId(p.postId) }}</td>
              <td class="cell-message" :title="p.postMessage">{{ truncate(p.postMessage, 100) }}</td>
              <td>
                <span v-if="p.phone" class="phone-cell">
                  <span class="mono table-link-color">{{ p.phone }}</span>
                  <button
                    class="copy-phone-btn"
                    type="button"
                    title="Sao chép SĐT"
                    :aria-label="`Sao chép ${p.phone}`"
                    @click="copyPhone(p.phone)"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" />
                      <path
                        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                </span>
                <span v-else>—</span>
              </td>
              <td>
                <a
                  v-if="p.userUrl"
                  class="table-link"
                  :href="p.userUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ p.userName || p.userId || '—' }}
                </a>
                <span v-else>{{ p.userName || p.userId || '—' }}</span>
              </td>
              <td>{{ p.groupName || '—' }}</td>
              <td class="mono">{{ p.groupId || '—' }}</td>
              <td class="muted">{{ formatCreatedTime(p.created_time) }}</td>
              <td class="muted">{{ formatScannedAt(p.scannedAt) }}</td>
              <td>
                <a
                  v-if="p.postUrl"
                  class="table-link"
                  :href="p.postUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở
                </a>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'phone'" class="table-wrap">
        <table class="user-table phone-table">
          <thead>
            <tr>
              <th class="col-check">
                <input v-model="allPhonesSelected" type="checkbox" aria-label="Chọn tất cả SĐT" />
              </th>
              <th class="col-stt">STT</th>
              <th>SĐT</th>
              <th>Tên FB</th>
              <th>Số bài</th>
              <th>Thời gian gần nhất</th>
              <th>Thời gian quét mới nhất</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(group, index) in phoneGroups" :key="group.phone">
              <td class="col-check">
                <input
                  v-model="selectedPhones"
                  type="checkbox"
                  :value="group.phone"
                  :aria-label="`Chọn ${group.phone}`"
                />
              </td>
              <td class="col-stt mono">{{ rowStt(index) }}</td>
              <td>
                <span class="phone-cell">
                  <span class="mono table-link-color">{{ group.phone }}</span>
                  <button
                    v-if="group.phone !== 'Không có SĐT'"
                    class="copy-phone-btn"
                    type="button"
                    title="Sao chép SĐT"
                    :aria-label="`Sao chép ${group.phone}`"
                    @click="copyPhone(group.phone)"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" />
                      <path
                        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                </span>
              </td>
              <td>{{ group.userNames.length ? group.userNames.join(', ') : '—' }}</td>
              <td>
                <button
                  class="phone-count-btn"
                  type="button"
                  :title="`Xem ${group.count || 0} link bài`"
                  @click="openPostLinksModal(group)"
                >
                  {{ group.count || 0 }}
                </button>
              </td>
              <td class="muted">{{ formatLatest(group.latestTime) }}</td>
              <td class="muted">{{ formatLatest(group.latestScannedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </template>

      <p v-else-if="!loading" class="empty">
        {{ total || hasActiveFilters ? 'Không có kết quả phù hợp.' : 'Chưa có bài đăng nào.' }}
      </p>
    </div>

    <div v-if="total > 0 || hasActiveFilters" class="pagination">
      <button
        class="btn btn--ghost btn--tiny"
        type="button"
        :disabled="loading || page <= 1"
        @click="goToPage(page - 1)"
      >
        Trước
      </button>

      <button
        v-if="pageNumbers[0] > 1"
        class="page-btn"
        type="button"
        :disabled="loading"
        @click="goToPage(1)"
      >
        1
      </button>
      <span v-if="pageNumbers[0] > 2" class="page-ellipsis">…</span>

      <button
        v-for="n in pageNumbers"
        :key="n"
        class="page-btn"
        type="button"
        :class="{ active: n === page }"
        :disabled="loading"
        @click="goToPage(n)"
      >
        {{ n }}
      </button>

      <span v-if="pageNumbers[pageNumbers.length - 1] < totalPages - 1" class="page-ellipsis">…</span>
      <button
        v-if="pageNumbers[pageNumbers.length - 1] < totalPages"
        class="page-btn"
        type="button"
        :disabled="loading"
        @click="goToPage(totalPages)"
      >
        {{ totalPages }}
      </button>

      <button
        class="btn btn--ghost btn--tiny"
        type="button"
        :disabled="loading || page >= totalPages"
        @click="goToPage(page + 1)"
      >
        Sau
      </button>

      <span class="muted page-meta">
        Trang {{ page }}/{{ totalPages }} · offset {{ (page - 1) * pageLimit }}
      </span>
    </div>
  </section>

  <KeywordFilterFlow
    :open="showKeywordFlow"
    @close="showKeywordFlow = false"
    @change="onKeywordFlowChange"
    @apply="onKeywordFlowChange"
  />

  <Teleport to="body">
    <div
      v-if="showPostLinksModal && postLinksGroup"
      class="modal-overlay fade-in"
      @click.self="closePostLinksModal"
    >
      <div
        class="modal-card modal-card--wide slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-links-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="post-links-title">Link bài viết</h3>
            <p>
              SĐT
              <span class="mono table-link-color">{{ postLinksGroup.phone }}</span>
              · {{ postLinksTotal }}
              <template v-if="postLinksNameFilter && postLinksGroup.count && postLinksTotal !== postLinksGroup.count">
                / {{ postLinksGroup.count }}
              </template>
              bài
            </p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closePostLinksModal">
            ×
          </button>
        </div>

        <div class="posts-filters post-links-filters">
          <label class="group-filter-box" title="Lọc theo tên FB">
            <span class="sr-only">Lọc tên FB</span>
            <select v-model="postLinksNameFilter" aria-label="Lọc theo tên FB">
              <option value="">Tất cả tên FB</option>
              <option v-for="name in postLinksNameOptions" :key="name" :value="name">
                {{ name }}
              </option>
            </select>
          </label>
        </div>

        <div class="modal-table-wrap" style="position: relative; min-height: 120px">
          <LoadingState v-if="postLinksLoading" :overlay="!!postLinksPageItems.length" />
          <div v-if="postLinksPageItems.length" class="table-wrap modal-table">
            <table class="user-table post-links-table">
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Tên FB</th>
                  <th>Tên nhóm</th>
                  <th>ID nhóm</th>
                  <th>Link</th>
                  <th>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(p, index) in postLinksPageItems"
                  :key="p.postId || p.id || index"
                >
                  <td class="mono">{{ (postLinksPage - 1) * postLinksPageSize + index + 1 }}</td>
                  <td>
                    <a
                      v-if="p.userUrl && p.userName"
                      class="table-link"
                      :href="p.userUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ p.userName }}
                    </a>
                    <span v-else>{{ p.userName || '—' }}</span>
                  </td>
                  <td class="cell-group-name">{{ p.groupName || '—' }}</td>
                  <td class="mono cell-group-id">{{ p.groupId || '—' }}</td>
                  <td class="cell-clip">
                    <a
                      v-if="p.postUrl"
                      class="table-link"
                      :href="p.postUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ p.postUrl }}
                    </a>
                    <span v-else>—</span>
                  </td>
                  <td class="muted">{{ formatCreatedTime(p.created_time) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="!postLinksLoading" class="empty">
            {{ postLinksNameFilter ? 'Không có bài khớp tên FB.' : 'Không có link bài viết.' }}
          </p>
        </div>

        <div v-if="postLinksTotal > 0" class="pagination post-links-pagination">
          <button
            class="btn btn--ghost btn--tiny"
            type="button"
            :disabled="postLinksLoading || postLinksPage <= 1"
            @click="goToPostLinksPage(postLinksPage - 1)"
          >
            Trước
          </button>

          <button
            v-if="postLinksPageNumbers[0] > 1"
            class="page-btn"
            type="button"
            @click="goToPostLinksPage(1)"
          >
            1
          </button>
          <span v-if="postLinksPageNumbers[0] > 2" class="page-ellipsis">…</span>

          <button
            v-for="n in postLinksPageNumbers"
            :key="n"
            class="page-btn"
            type="button"
            :class="{ active: n === postLinksPage }"
            @click="goToPostLinksPage(n)"
          >
            {{ n }}
          </button>

          <span
            v-if="postLinksPageNumbers[postLinksPageNumbers.length - 1] < postLinksTotalPages - 1"
            class="page-ellipsis"
          >…</span>
          <button
            v-if="postLinksPageNumbers[postLinksPageNumbers.length - 1] < postLinksTotalPages"
            class="page-btn"
            type="button"
            @click="goToPostLinksPage(postLinksTotalPages)"
          >
            {{ postLinksTotalPages }}
          </button>

          <button
            class="btn btn--ghost btn--tiny"
            type="button"
            :disabled="postLinksLoading || postLinksPage >= postLinksTotalPages"
            @click="goToPostLinksPage(postLinksPage + 1)"
          >
            Sau
          </button>

          <span class="muted page-meta">
            Trang {{ postLinksPage }}/{{ postLinksTotalPages }}
            · {{ postLinksPageSize }}/trang
          </span>
        </div>

        <div class="modal-actions">
          <button class="btn btn--ghost" type="button" @click="closePostLinksModal">Đóng</button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="showCampaignFilterModal"
      class="modal-overlay fade-in"
      @click.self="closeCampaignFilterModal"
    >
      <div
        class="modal-card slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-filter-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="campaign-filter-title">Lọc theo chiến dịch</h3>
            <p>Chọn chiến dịch, rồi lọc SĐT đã thêm / chưa thêm</p>
          </div>
          <button
            class="modal-close"
            type="button"
            aria-label="Đóng"
            @click="closeCampaignFilterModal"
          >
            ×
          </button>
        </div>

        <div v-if="campaignFilterError" class="alert alert--error">{{ campaignFilterError }}</div>
        <LoadingState v-if="campaignsLoading" compact />

        <template v-else>
          <div v-if="campaigns.length" class="field">
            <label for="campaign-filter-select">Chiến dịch</label>
            <select id="campaign-filter-select" v-model="campaignFilterDraftId">
              <option :value="null" disabled>Chọn chiến dịch…</option>
              <option v-for="c in campaigns" :key="c.id" :value="c.id">
                {{ c.name }} ({{ c.phoneCount || 0 }} SĐT)
              </option>
            </select>
          </div>
          <p v-else class="empty">Chưa có chiến dịch nào.</p>

          <div class="field">
            <span class="field-label-text">Trạng thái SĐT</span>
            <div class="role-switch campaign-membership-switch" role="group" aria-label="Trạng thái SĐT">
              <button
                type="button"
                :class="{ active: campaignFilterDraftMembership === 'out' }"
                @click="campaignFilterDraftMembership = 'out'"
              >
                Chưa thêm
              </button>
              <button
                type="button"
                :class="{ active: campaignFilterDraftMembership === 'in' }"
                @click="campaignFilterDraftMembership = 'in'"
              >
                Đã thêm
              </button>
            </div>
          </div>
        </template>

        <div class="modal-actions">
          <button
            v-if="hasCampaignFilter"
            class="btn btn--ghost"
            type="button"
            @click="clearCampaignFilter(); closeCampaignFilterModal()"
          >
            Xóa lọc
          </button>
          <button class="btn btn--ghost" type="button" @click="closeCampaignFilterModal">Hủy</button>
          <button
            class="btn btn--primary btn--inline"
            type="button"
            :disabled="campaignsLoading || !campaigns.length || !campaignFilterDraftId"
            @click="applyCampaignFilter"
          >
            Áp dụng
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="showCampaignModal"
      class="modal-overlay fade-in"
      @click.self="closeCampaignModal"
    >
      <div
        class="modal-card slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-campaign-title"
      >
        <div class="modal-head">
          <div>
            <h3 id="push-campaign-title">Đẩy vào chiến dịch</h3>
            <p>{{ selectedCampaignItems.length }} SĐT sẽ được thêm (trùng thì bỏ qua)</p>
          </div>
          <button class="modal-close" type="button" aria-label="Đóng" @click="closeCampaignModal">
            ×
          </button>
        </div>

        <div v-if="pushError" class="alert alert--error">{{ pushError }}</div>
        <LoadingState v-if="campaignsLoading" compact label="Đang tải chiến dịch…" />

        <template v-else>
          <div v-if="campaigns.length" class="field">
            <label for="push-campaign-select">Chọn chiến dịch</label>
            <select id="push-campaign-select" v-model="selectedCampaignId">
              <option :value="null" disabled>Chọn chiến dịch…</option>
              <option v-for="c in campaigns" :key="c.id" :value="c.id">
                {{ c.name }} ({{ c.phoneCount || 0 }} SĐT)
              </option>
            </select>
          </div>
          <p v-else class="empty">Chưa có chiến dịch nào. Tạo chiến dịch trước.</p>
        </template>

        <div class="modal-actions">
          <button class="btn btn--ghost" type="button" @click="closeCampaignModal">Hủy</button>
          <button
            class="btn btn--primary btn--inline"
            type="button"
            :disabled="pushBusy || campaignsLoading || !selectedCampaignId"
            @click="pushToCampaign"
          >
            <span v-if="pushBusy" class="spinner spinner--sm" aria-hidden="true" />
            {{ pushBusy ? 'Đang đẩy…' : 'Đẩy vào' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <Transition name="toast-up">
      <div v-if="toastVisible" class="app-toast" role="status" aria-live="polite">
        {{ toastMessage }}
      </div>
    </Transition>
  </Teleport>
</template>
