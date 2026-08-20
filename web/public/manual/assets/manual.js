const storageKey = 'kayford.manual.acceptance.v1';
const checkboxes = [...document.querySelectorAll('.accept-check')];
const progressLabel = document.querySelector('#progress-label');
const progressBar = document.querySelector('#progress-bar');
const progressDetail = document.querySelector('#progress-detail');

function loadChecks() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch {
    return {};
  }
}

function updateProgress() {
  const completed = checkboxes.filter((checkbox) => checkbox.checked).length;
  const total = checkboxes.length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  progressLabel.textContent = `${percentage}%`;
  progressBar.style.width = `${percentage}%`;
  progressDetail.textContent = completed === 0 ? '尚未勾选验收项' : `已完成 ${completed} / ${total} 项`;
}

const savedChecks = loadChecks();
checkboxes.forEach((checkbox) => {
  checkbox.checked = Boolean(savedChecks[checkbox.dataset.check]);
  checkbox.addEventListener('change', () => {
    const current = loadChecks();
    current[checkbox.dataset.check] = checkbox.checked;
    localStorage.setItem(storageKey, JSON.stringify(current));
    updateProgress();
  });
});
updateProgress();

document.querySelector('#reset-progress')?.addEventListener('click', () => {
  if (!window.confirm('确定清空本机保存的验收勾选记录吗？')) return;
  localStorage.removeItem(storageKey);
  checkboxes.forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateProgress();
});

document.querySelector('#print-manual')?.addEventListener('click', () => window.print());

const copyIssueButton = document.querySelector('#copy-issue');
copyIssueButton?.addEventListener('click', async () => {
  const text = document.querySelector('#issue-copy')?.textContent?.trim() || '';
  try {
    await navigator.clipboard.writeText(text);
    copyIssueButton.textContent = '已复制';
    window.setTimeout(() => {
      copyIssueButton.textContent = '复制模板';
    }, 1800);
  } catch {
    copyIssueButton.textContent = '请手动复制';
  }
});

const dialog = document.querySelector('#image-dialog');
const dialogImage = document.querySelector('#dialog-image');
const dialogCaption = document.querySelector('#dialog-caption');

document.querySelectorAll('.image-button').forEach((button) => {
  button.addEventListener('click', () => {
    dialogImage.src = button.dataset.image;
    dialogImage.alt = button.dataset.caption || '系统页面大图';
    dialogCaption.textContent = button.dataset.caption || '';
    dialog.showModal();
  });
});

document.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

const sidebar = document.querySelector('#manual-sidebar');
const mobileToggle = document.querySelector('.mobile-nav-toggle');

mobileToggle?.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  mobileToggle.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.toc a').forEach((link) => {
  link.addEventListener('click', () => {
    sidebar.classList.remove('open');
    mobileToggle?.setAttribute('aria-expanded', 'false');
  });
});

const navLinks = [...document.querySelectorAll('.toc a')];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`);
    });
  },
  { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.1, 0.3] },
);

sections.forEach((section) => observer.observe(section));
