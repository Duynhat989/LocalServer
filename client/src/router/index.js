import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../composables/useAuth';
import AppLayout from '../layouts/AppLayout.vue';
import HomeView from '../views/HomeView.vue';
import PostsView from '../views/PostsView.vue';
import GroupsView from '../views/GroupsView.vue';
import CampaignsView from '../views/CampaignsView.vue';
import ProfileView from '../views/ProfileView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { guest: true },
    },
    {
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'home',
          component: HomeView,
        },
        {
          path: 'users',
          redirect: { name: 'profile', query: { tab: 'users' } },
        },
        {
          path: 'posts',
          name: 'posts',
          component: PostsView,
          meta: { requiresStaff: true },
        },
        {
          path: 'groups',
          name: 'groups',
          component: GroupsView,
          meta: { requiresStaff: true },
        },
        {
          path: 'campaigns',
          name: 'campaigns',
          component: CampaignsView,
        },
        {
          path: 'history',
          redirect: { name: 'profile', query: { tab: 'history' } },
        },
        {
          path: 'profile',
          name: 'profile',
          component: ProfileView,
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

router.beforeEach(async (to) => {
  const { bootstrap, isAuthenticated, isAdmin, isStaff } = useAuth();
  // Không chặn chuyển trang nếu đã bootstrap xong (promise cache)
  await bootstrap();

  const needsAuth = to.matched.some((record) => record.meta.requiresAuth);
  if (needsAuth && !isAuthenticated.value) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (to.meta.guest && isAuthenticated.value) {
    return { name: 'home' };
  }

  const needsAdmin = to.matched.some((record) => record.meta.requiresAdmin);
  if (needsAdmin && !isAdmin.value) {
    return { name: 'home' };
  }

  const needsStaff = to.matched.some((record) => record.meta.requiresStaff);
  if (needsStaff && !isStaff.value) {
    return { name: 'home' };
  }

  return true;
});

export default router;
