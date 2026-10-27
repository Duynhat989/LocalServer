const badgeEl = document.getElementById('badge');
const portEl = document.getElementById('port');
const openWebBtn = document.getElementById('openWeb');
const checkLicenseBtn = document.getElementById('checkLicense');
const urlTextEl = document.getElementById('urlText');
const startedAtEl = document.getElementById('startedAt');
const recheckCountdownEl = document.getElementById('recheckCountdown');
const errorEl = document.getElementById('error');
const userCountEl = document.getElementById('userCount');
const adminCountEl = document.getElementById('adminCount');
const waitingPanelEl = document.getElementById('waitingPanel');
const activePanelEl = document.getElementById('activePanel');
const waitingDetailEl = document.getElementById('waitingDetail');
const heroTitleEl = document.getElementById('heroTitle');
const heroLeadEl = document.getElementById('heroLead');

let nextCheckAtMs = null;
let countdownTimer = null;

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateCountdown() {
  if (!recheckCountdownEl) return;
  if (!nextCheckAtMs) {
    recheckCountdownEl.textContent = '—';
    return;
  }
  const remain = nextCheckAtMs - Date.now();
  if (remain <= 0) {
    recheckCountdownEl.textContent = '00:00';
    return;
  }
  recheckCountdownEl.textContent = formatCountdown(remain);
}

function startCountdownTicker() {
  if (countdownTimer) return;
  countdownTimer = setInterval(updateCountdown, 1000);
}

function renderStatus(status) {
  if (!status) return;

  const license = status.license || {};
  const activated = Boolean(license.activated);
  const checking = Boolean(license.checking);

  const url = status.url || `http://localhost:${status.port || 6868}`;
  portEl.textContent = String(status.port || 6868);
  urlTextEl.textContent = activated && status.running ? url : '—';
  startedAtEl.textContent = activated ? formatTime(status.startedAt) : '—';
  userCountEl.textContent = String(activated ? status.userCount ?? 0 : 0);
  adminCountEl.textContent = String(activated ? status.adminCount ?? 0 : 0);

  if (waitingPanelEl) waitingPanelEl.hidden = activated;
  if (activePanelEl) activePanelEl.hidden = !activated;
  openWebBtn.disabled = !activated || !status.running;
  if (checkLicenseBtn) {
    checkLicenseBtn.disabled = checking;
    checkLicenseBtn.textContent = checking ? 'Đang kiểm tra…' : 'Kiểm tra lại';
  }

  if (activated && license.nextCheckAt) {
    nextCheckAtMs = new Date(license.nextCheckAt).getTime();
    if (Number.isNaN(nextCheckAtMs)) nextCheckAtMs = null;
  } else {
    nextCheckAtMs = null;
  }
  updateCountdown();

  if (checking && !activated) {
    badgeEl.textContent = 'Đang kiểm tra…';
    badgeEl.className = 'badge badge--off';
    heroTitleEl.textContent = 'Đang kiểm tra kích hoạt';
    heroLeadEl.textContent = 'Đang xác minh trạng thái kích hoạt…';
  } else if (!activated) {
    badgeEl.textContent = 'Chờ kích hoạt';
    badgeEl.className = 'badge badge--wait';
    heroTitleEl.textContent = 'Đang chờ kích hoạt';
    heroLeadEl.textContent =
      'Ứng dụng chưa được kích hoạt. Liên hệ quản trị viên, rồi bấm Kiểm tra lại.';
    if (waitingDetailEl) {
      waitingDetailEl.textContent = `Lần kiểm tra: ${formatTime(license.checkedAt)}`;
    }
  } else if (status.running) {
    badgeEl.textContent = 'Đang chạy';
    badgeEl.className = 'badge badge--on';
    heroTitleEl.textContent = 'Đang theo dõi hệ thống';
    heroLeadEl.textContent =
      'Electron chỉ hiển thị báo cáo. Đăng nhập và quản lý user trên giao diện web.';
  } else {
    badgeEl.textContent = 'Dừng';
    badgeEl.className = 'badge badge--off';
    heroTitleEl.textContent = 'Server chưa chạy';
    heroLeadEl.textContent = status.error || 'Đã kích hoạt nhưng HTTP server chưa lắng nghe.';
  }

  if (status.error && activated) {
    errorEl.hidden = false;
    errorEl.textContent = status.error;
  } else {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }
}

async function init() {
  if (!window.localServer) return;

  startCountdownTicker();

  openWebBtn.addEventListener('click', async () => {
    const result = await window.localServer.openWeb();
    if (result && result.ok === false && result.error) {
      errorEl.hidden = false;
      errorEl.textContent = result.error;
    }
  });

  if (checkLicenseBtn) {
    checkLicenseBtn.addEventListener('click', async () => {
      checkLicenseBtn.disabled = true;
      checkLicenseBtn.textContent = 'Đang kiểm tra…';
      const status = await window.localServer.checkLicense();
      renderStatus(status);
    });
  }

  const status = await window.localServer.getStatus();
  renderStatus(status);
  window.localServer.onStatus(renderStatus);
}

init();
