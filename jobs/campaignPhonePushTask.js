const crypto = require('crypto');

const tasks = new Map();
const TASK_TTL_MS = 60 * 60 * 1000;

function pruneTasks() {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (task.finishedAt && now - task.finishedAt > TASK_TTL_MS) {
      tasks.delete(id);
    }
  }
}

function toPublicTask(task) {
  return {
    id: task.id,
    campaignId: task.campaignId,
    campaignName: task.campaignName,
    status: task.status,
    total: task.total,
    processed: task.processed,
    added: task.added,
    duplicateCount: task.duplicateCount,
    duplicates: task.duplicates.slice(0, 100),
    stepAdd: task.stepAdd,
    error: task.error,
    percent: task.total ? Math.min(100, Math.round((task.processed / task.total) * 100)) : 0,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
  };
}

function getCampaignPhonePushTask(taskId, userId) {
  pruneTasks();
  const task = tasks.get(String(taskId || '').trim());
  if (!task) return null;
  if (userId != null && task.userId != null && task.userId !== userId) {
    return null;
  }
  return toPublicTask(task);
}

function getCampaignPhonePushTaskInternal(taskId) {
  return tasks.get(String(taskId || '').trim()) || null;
}

function createCampaignPhonePushTask(payload) {
  pruneTasks();
  const id = crypto.randomUUID();
  const task = {
    id,
    campaignId: payload.campaignId,
    campaignName: payload.campaignName || '',
    userId: payload.userId ?? null,
    username: payload.username ?? null,
    status: 'pending',
    total: payload.pushAll
      ? Math.max(0, Number(payload.estimatedTotal) || 0)
      : payload.items.length,
    processed: 0,
    added: 0,
    duplicateCount: 0,
    duplicates: [],
    stepAdd: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    pushAll: Boolean(payload.pushAll),
    _pushAll: Boolean(payload.pushAll),
    _listQuery: payload.listQuery || null,
    _items: payload.pushAll ? null : payload.items,
    _enrichOptions: payload.enrichOptions || {},
  };

  tasks.set(id, task);

  setImmediate(() => {
    runCampaignPhonePushTask(id).catch((err) => {
      const t = tasks.get(id);
      if (!t) return;
      t.status = 'error';
      t.error = err.message || 'Lỗi đẩy chiến dịch';
      t.finishedAt = Date.now();
      delete t._items;
      delete t._enrichOptions;
      delete t._pushAll;
      delete t._listQuery;
    });
  });

  return toPublicTask(task);
}

async function runCampaignPhonePushTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status !== 'pending') return;

  task.status = 'running';
  const { executeAddPhonesForTask } = require('../controllers/campaignController');
  await executeAddPhonesForTask(task);
}

module.exports = {
  createCampaignPhonePushTask,
  getCampaignPhonePushTask,
  getCampaignPhonePushTaskInternal,
};
