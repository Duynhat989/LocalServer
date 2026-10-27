<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useAuth } from '../composables/useAuth';
import LoadingState from '../components/LoadingState.vue';

const { user, token } = useAuth();
const stats = ref(null);
const statsLoading = ref(true);
const statsError = ref('');

const timeLabel = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buổi sáng tốt lành';
  if (hour < 18) return 'Buổi chiều vui vẻ';
  return 'Buổi tối an lành';
});

const greeting = computed(() => `Xin chào, ${user.value?.username || ''}`);

const summaryCards = computed(() => {
  const today = stats.value?.today;
  const month = stats.value?.month;
  if (!today || !month) return [];
  return [
    { label: 'Bài viết hôm nay', value: today.posts, hint: today.label },
    { label: 'SĐT mới hôm nay', value: today.phones, hint: today.label },
    { label: 'Nhóm đã quét hôm nay', value: today.groups, hint: today.label },
    { label: 'Bài viết tháng này', value: month.posts, hint: month.label },
    { label: 'SĐT mới tháng này', value: month.phones, hint: month.label },
    { label: 'Nhóm đã quét tháng này', value: month.groups, hint: month.label },
  ];
});

function seriesMax(rows) {
  const values = (rows || []).flatMap((row) => [row.posts, row.phones, row.groups]);
  return Math.max(1, ...values);
}

function barHeight(value, max) {
  const ratio = Math.max(0, Number(value) || 0) / max;
  return `${Math.max(ratio > 0 ? 4 : 0, Math.round(ratio * 100))}%`;
}

function formatCount(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function newestFirst(rows) {
  return [...(rows || [])].reverse();
}

const dayMax = computed(() => seriesMax(stats.value?.days));
const monthMax = computed(() => seriesMax(stats.value?.months));

async function loadStats() {
  statsLoading.value = true;
  statsError.value = '';
  try {
    stats.value = await api('/api/stats/home', { token: token.value });
  } catch (err) {
    statsError.value = err.message || 'Không tải được thống kê';
  } finally {
    statsLoading.value = false;
  }
}

onMounted(loadStats);
</script>

<template>
  <section class="home">
    <div class="home-card">
      <header class="home-head">
        <p class="eyebrow">{{ timeLabel }}</p>
        <h2 class="home-title">{{ greeting }}</h2>
        <p class="lead">
          Bài viết và nhóm tính theo thời điểm quét. SĐT mới là số điện thoại xuất hiện lần đầu.
        </p>
      </header>

      <LoadingState v-if="statsLoading" compact label="Đang tải thống kê…" />
      <div v-else-if="statsError" class="alert alert--error">{{ statsError }}</div>

      <template v-else-if="stats">
        <div class="home-kpis">
          <article v-for="card in summaryCards" :key="card.label" class="home-kpi">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <em>{{ card.hint }}</em>
          </article>
        </div>

        <div class="home-charts">
          <section class="home-chart-card">
            <div class="home-chart-head">
              <h3>14 ngày gần nhất</h3>
              <div class="home-legend">
                <span><i class="home-swatch home-swatch--posts" /> Bài viết</span>
                <span><i class="home-swatch home-swatch--phones" /> SĐT mới</span>
                <span><i class="home-swatch home-swatch--groups" /> Nhóm đã quét</span>
              </div>
            </div>
            <div class="home-chart">
              <div v-for="row in stats.days" :key="row.key" class="home-chart-col">
                <div class="home-chart-bars">
                  <span
                    class="home-bar home-bar--posts"
                    :style="{ height: barHeight(row.posts, dayMax) }"
                    :title="`Bài viết: ${row.posts}`"
                  />
                  <span
                    class="home-bar home-bar--phones"
                    :style="{ height: barHeight(row.phones, dayMax) }"
                    :title="`SĐT mới: ${row.phones}`"
                  />
                  <span
                    class="home-bar home-bar--groups"
                    :style="{ height: barHeight(row.groups, dayMax) }"
                    :title="`Nhóm: ${row.groups}`"
                  />
                </div>
                <em>{{ row.label }}</em>
              </div>
            </div>
            <table class="home-detail">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Bài viết</th>
                  <th>SĐT mới</th>
                  <th>Nhóm đã quét</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in newestFirst(stats.days)"
                  :key="row.key"
                  :class="{ 'is-empty': !row.posts && !row.phones && !row.groups }"
                >
                  <td>{{ row.label }}</td>
                  <td>{{ formatCount(row.posts) }}</td>
                  <td>{{ formatCount(row.phones) }}</td>
                  <td>{{ formatCount(row.groups) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="home-chart-card">
            <div class="home-chart-head">
              <h3>6 tháng gần nhất</h3>
            </div>
            <div class="home-chart home-chart--months">
              <div v-for="row in stats.months" :key="row.key" class="home-chart-col">
                <div class="home-chart-bars">
                  <span
                    class="home-bar home-bar--posts"
                    :style="{ height: barHeight(row.posts, monthMax) }"
                    :title="`Bài viết: ${row.posts}`"
                  />
                  <span
                    class="home-bar home-bar--phones"
                    :style="{ height: barHeight(row.phones, monthMax) }"
                    :title="`SĐT mới: ${row.phones}`"
                  />
                  <span
                    class="home-bar home-bar--groups"
                    :style="{ height: barHeight(row.groups, monthMax) }"
                    :title="`Nhóm: ${row.groups}`"
                  />
                </div>
                <em>{{ row.label }}</em>
              </div>
            </div>
            <table class="home-detail">
              <thead>
                <tr>
                  <th>Tháng</th>
                  <th>Bài viết</th>
                  <th>SĐT mới</th>
                  <th>Nhóm đã quét</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in newestFirst(stats.months)"
                  :key="row.key"
                  :class="{ 'is-empty': !row.posts && !row.phones && !row.groups }"
                >
                  <td>{{ row.label }}</td>
                  <td>{{ formatCount(row.posts) }}</td>
                  <td>{{ formatCount(row.phones) }}</td>
                  <td>{{ formatCount(row.groups) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </template>
    </div>
  </section>
</template>
