const tg = window.Telegram?.WebApp;

// Статика может жить на GitHub Pages, а API — на воркере: тогда нужен абсолютный адрес.
// Локально (127.0.0.1 воркера) API тот же самый — ходим по относительному пути.
const WORKER_URL = 'https://study-bot.vanya-study.workers.dev';
const WORKER_HOST = 'study-bot.vanya-study.workers.dev';
const LOCAL_HOST = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const API_BASE = LOCAL_HOST || location.hostname === WORKER_HOST ? '' : WORKER_URL;

const MAX_PHOTOS = 50;
const PHOTO_BATCH = 6;
const MAX_SIDE = 1400;

const SAMPLES = [
  'Реши 3x − 7 = 14','Сколько молей в 36 г воды?','Почему небо голубое?','Объясни теорему Пифагора на пальцах',
  'Что такое энтропия?','Как работает фотосинтез?','Проверь моё решение','Как быстро выучить 30 слов?',
  'Что почитать про космос?','Объясни разницу между массой и весом','Напиши план сочинения про осень',
  'Придумай 5 задач на проценты','Как решать системы уравнений?','Что такое ВВП простыми словами',
  'Почему идёт дождь?','Сколько планет в Солнечной системе?','Кто такой Ломоносов?','Объясни, что такое инфляция',
  'Как запомнить формулы по физике?','Что такое ДНК?','Переведи на английский: «я учусь в школе»',
  'Придумай вопрос для викторины','Как подготовиться к контрольной за вечер?','Что такое логарифм?',
  'Объясни, как работает двигатель','Почему вода кипит при 100 градусах?','Напиши короткий рассказ про робота',
  'Как считать дроби?','Что такое гравитация?','Помоги с домашкой по химии'
];

/** Запасной список моделей: нужен, пока /api/me не ответил. */
const FALLBACK_MODELS = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash', title: 'Flash', group: 'DeepSeek', vision: true, note: 'Видит фото и умеет искать в интернете.' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', title: 'V4 Pro', group: 'DeepSeek', vision: false, note: 'Сильнее, но дороже Flash.' },
  { id: 'glm-4.5-flash', label: 'GLM Flash · Z.ai', title: 'GLM Flash', group: 'Z.ai', vision: false, note: 'Бесплатная модель Z.ai.' },
  { id: 'glm-4.6', label: 'GLM 4.6 · Z.ai', title: 'GLM 4.6', group: 'Z.ai', vision: false, note: 'Нужен баланс на ключе Z.ai.' },
  { id: 'glm-dan', label: 'Дип · без цензуры', title: 'Без цензуры', group: 'Z.ai · свободный', vision: false, badge: 'Z.ai', note: 'Характер без фильтра.' }
];

const feed = document.getElementById('feed');
const form = document.getElementById('form');
const textBox = document.getElementById('text');
const sendBtn = document.getElementById('sendBtn');
const chips = document.getElementById('chips');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');
const dot = document.getElementById('statusDot');
const modelLabel = document.getElementById('modelLabel');
const photoBtn = document.getElementById('photoBtn');
const fileInput = document.getElementById('fileInput');
const tray = document.getElementById('tray');
const trayList = document.getElementById('trayList');
const trayCount = document.getElementById('trayCount');
const modelList = document.getElementById('modelList');
const modelHint = document.getElementById('modelHint');

const state = {
  initData: '',
  appKey: '',
  busy: false,
  lastQuestion: '',
  threadId: null,
  model: 'deepseek-flash',
  models: FALLBACK_MODELS.slice(),
  attachments: [],
  spentToday: 0,
  capUsd: 0
};

/* ---------- инфраструктура ---------- */

function toast(message) {
  toastEl.textContent = message;
  toastEl.dataset.show = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toastEl.dataset.show = 'false';
  }, 2400);
}

function setStatus(kind) {
  dot.className = 'dot' + (kind === 'busy' ? ' dot--busy' : kind === 'error' ? ' dot--error' : '');
}

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-init-data': state.initData,
      ...(state.appKey ? { 'x-app-key': state.appKey } : {}),
      ...(options.headers || {})
    }
  });
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.error || `http_${res.status}`;
    err.data = data;
    throw err;
  }
  return data;
}

function scrollDown(smooth = true) {
  requestAnimationFrame(() => {
    feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Полужирные фрагменты модель иногда пишет markdown-ом — превращаем в акцент. */
function formatAnswer(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/* ---------- модели ---------- */

function modelInfo(id) {
  return state.models.find((m) => m.id === id) || state.models[0] || FALLBACK_MODELS[0];
}

function currentModel() {
  return modelInfo(state.model);
}

function renderModels() {
  modelList.innerHTML = '';
  let group = null;
  let seg = null;
  for (const model of state.models) {
    if (model.group !== group) {
      group = model.group;
      const name = document.createElement('span');
      name.className = 'models__name';
      name.textContent = group;
      modelList.appendChild(name);
      seg = document.createElement('div');
      seg.className = 'seg seg--wrap';
      modelList.appendChild(seg);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.v = model.id;
    button.dataset.active = String(model.id === state.model);
    button.textContent = model.title;
    if (model.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = model.badge;
      button.append(' ', badge);
    }
    button.addEventListener('click', () => pickModel(model.id));
    seg.appendChild(button);
  }
}

function applyModelUi() {
  const info = currentModel();
  modelLabel.textContent = info.label;
  photoBtn.hidden = !info.vision;
  if (modelHint) modelHint.textContent = info.note || '';
  if (!info.vision && state.attachments.length) {
    state.attachments = [];
    renderTray();
    toast('Фото понимает только DeepSeek Flash');
  }
}

async function pickModel(id) {
  if (state.model === id) return;
  state.model = id;
  for (const button of modelList.querySelectorAll('button')) {
    button.dataset.active = String(button.dataset.v === id);
  }
  applyModelUi();
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ model: id }) });
    toast(`Модель: ${currentModel().label}`);
  } catch (err) {
    toast(err.code === 'forbidden' ? 'Менять модель может только владелец' : 'Не удалось сменить модель');
  }
}

/* ---------- сообщения ---------- */

function hideEmpty() {
  const empty = document.getElementById('empty');
  if (empty && empty.parentElement) empty.remove();
}

function buildEmpty() {
  const section = document.createElement('section');
  section.className = 'empty';
  section.id = 'empty';

  const title = document.createElement('h1');
  title.textContent = 'Что решаем?';
  const text = document.createElement('p');
  text.textContent = 'Спроси словами или пришли до 50 фото задач — отвечу коротко и по делу. Фото понимает DeepSeek Flash.';

  const samples = document.createElement('div');
  samples.className = 'samples';
  const pool = [...SAMPLES].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const value of pool) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample';
    button.dataset.q = value;
    button.textContent = value;
    samples.appendChild(button);
  }

  section.append(title, text, samples);
  return section;
}

function showEmpty() {
  feed.innerHTML = '';
  feed.appendChild(buildEmpty());
}

function addUserMessage(text, thumbs) {
  hideEmpty();
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg--user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (thumbs && thumbs.length) {
    const row = document.createElement('div');
    row.className = 'bubble__photos';
    for (const src of thumbs) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      row.appendChild(img);
    }
    bubble.appendChild(row);
  }

  const line = document.createElement('div');
  line.className = 'bubble__text';
  if (text) {
    line.textContent = text;
  } else {
    line.classList.add('bubble__text--muted');
    line.textContent = `[${(thumbs || []).length} фото]`;
  }
  bubble.appendChild(line);

  wrapper.appendChild(bubble);
  feed.appendChild(wrapper);
  scrollDown();
}

function addProgress(label) {
  hideEmpty();
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg--bot';
  wrapper.dataset.typing = 'true';

  const box = document.createElement('div');
  box.className = 'progress';
  const dots = document.createElement('div');
  dots.className = 'typing';
  dots.innerHTML = '<span></span><span></span><span></span>';
  const caption = document.createElement('span');
  caption.className = 'progress__label';
  caption.textContent = label || 'Думаю…';
  box.append(dots, caption);
  wrapper.appendChild(box);

  feed.appendChild(wrapper);
  scrollDown();
  return { wrapper, caption };
}

function setProgress(progress, label) {
  if (progress && progress.caption) progress.caption.textContent = label;
}

function metaLine(data) {
  const parts = [];
  if (data.modelLabel) parts.push(data.modelLabel);
  if (data.searches) parts.push('поиск в интернете');
  if (data.ms) parts.push(`${(data.ms / 1000).toFixed(1)} с`);
  if (typeof data.cost === 'number' && data.cost > 0) parts.push(`$${data.cost.toFixed(4)}`);
  return parts.join(' · ');
}

function addBotMessage(text, meta) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg--bot';
  const answer = document.createElement('div');
  answer.className = 'answer';
  answer.innerHTML = formatAnswer(text);
  wrapper.appendChild(answer);

  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'msg__meta';
    metaEl.textContent = meta;
    wrapper.appendChild(metaEl);
  }

  const actions = document.createElement('div');
  actions.className = 'msg__actions';
  for (const [label, mode] of [
    ['Подробнее', 'more'],
    ['Проще', 'simpler']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = label;
    button.addEventListener('click', () => askQuestion({ text: state.lastQuestion, mode }));
    actions.appendChild(button);
  }
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ghost';
  copy.textContent = 'Копировать';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(answer.textContent || '');
      toast('Скопировано');
    } catch {
      toast('Не получилось скопировать');
    }
  });
  actions.appendChild(copy);
  wrapper.appendChild(actions);

  feed.appendChild(wrapper);
  scrollDown();
  return wrapper;
}

function errorMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg--bot';
  const answer = document.createElement('div');
  answer.className = 'answer';
  answer.textContent = text;
  answer.style.color = '#ff8b8b';
  wrapper.appendChild(answer);
  feed.appendChild(wrapper);
  scrollDown();
}

function friendlyError(err) {
  const code = err && err.code;
  if (code === 'unauthorized') return 'Открой приложение через Telegram — без подписи доступ закрыт.';
  if (code === 'forbidden') return 'Нет доступа. Попроси владельца добавить тебя в список.';
  if (code === 'rate_limited') return 'Слишком много запросов подряд. Подожди пару минут.';
  if (code === 'daily_cap') {
    const cap = err.data && err.data.capUsd ? `$${err.data.capUsd}` : '';
    return `Дневной лимит расходов${cap ? ` (${cap})` : ''} исчерпан. Лимит меняется в настройках.`;
  }
  if (code === 'too_big') return 'Фото слишком тяжёлые. Пришли меньше или по одному.';
  if (code === 'too_many') return `За раз можно до ${MAX_PHOTOS} фото.`;
  if (code === 'bad_image') return 'Не получилось прочитать одно из фото. Попробуй другое.';
  if (code === 'no_images') return 'Не вижу фото — прикрепи ещё раз.';
  if (code === 'vision_unavailable') return 'Фото понимает только DeepSeek Flash. Переключи модель в настройках.';
  if (code === 'balance') return 'У выбранной модели закончился баланс. Возьми DeepSeek Flash.';
  if (code === 'api_key') return 'Сервис модели не принял ключ. Возьми DeepSeek Flash.';
  if (code === 'model_busy') return 'Модель перегружена. Повтори через полминуты.';
  if (code === 'timeout') return 'Модель не ответила вовремя. Попробуй ещё раз.';
  if (code === 'provider') return 'Сбой на стороне модели. Повтори через минуту.';
  return 'Не получилось ответить. Попробуй ещё раз.';
}

/* ---------- фото ---------- */

function renderTray() {
  const count = state.attachments.length;
  tray.hidden = count === 0;
  trayCount.textContent = `${count} / ${MAX_PHOTOS}`;
  trayList.innerHTML = '';
  state.attachments.forEach((item, index) => {
    const cell = document.createElement('div');
    cell.className = 'thumb';
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb__del';
    remove.setAttribute('aria-label', 'Убрать фото');
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      state.attachments.splice(index, 1);
      renderTray();
    });
    cell.append(img, remove);
    trayList.appendChild(cell);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

/** Уменьшает фото на телефоне, чтобы 50 штук влезали в один запрос и не жгли токены. */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error('empty');
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

    const thumbCanvas = document.createElement('canvas');
    const thumbScale = Math.min(1, 180 / Math.max(canvas.width, canvas.height));
    thumbCanvas.width = Math.max(1, Math.round(canvas.width * thumbScale));
    thumbCanvas.height = Math.max(1, Math.round(canvas.height * thumbScale));
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumb = thumbCanvas.toDataURL('image/jpeg', 0.6);

    return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name || 'photo.jpg', dataUrl, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addPhotos(fileList) {
  const info = currentModel();
  if (!info.vision) {
    toast('Фото понимает только DeepSeek Flash');
    return;
  }
  const files = Array.from(fileList || []);
  let skipped = 0;
  for (const file of files) {
    if (state.attachments.length >= MAX_PHOTOS) {
      skipped += 1;
      continue;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      skipped += 1;
      continue;
    }
    try {
      state.attachments.push(await shrinkPhoto(file));
    } catch {
      skipped += 1;
    }
    renderTray();
  }
  renderTray();
  if (skipped) toast(skipped === 1 ? 'Одно фото не подошло' : `${skipped} фото не подошли`);
  if (state.attachments.length >= MAX_PHOTOS) toast(`Максимум ${MAX_PHOTOS} фото за раз`);
}

/* ---------- запрос ---------- */

function setBusy(busy) {
  state.busy = busy;
  sendBtn.disabled = busy;
  photoBtn.disabled = busy;
  if (!busy) setStatus('ok');
}

async function askWithPhotos(photos, text, progress) {
  const notes = [];
  for (let i = 0; i < photos.length; i += PHOTO_BATCH) {
    const batch = photos.slice(i, i + PHOTO_BATCH);
    const upto = Math.min(i + PHOTO_BATCH, photos.length);
    setProgress(progress, `Распознаю фото ${upto} из ${photos.length}…`);
    const data = await api('/api/vision', {
      method: 'POST',
      body: JSON.stringify({ images: batch.map((p) => ({ id: p.id, data: p.dataUrl })), from: i })
    });
    if (Array.isArray(data.items)) notes.push(...data.items);
  }
  setProgress(progress, 'Решаю…');
  return api('/api/photo-ask', {
    method: 'POST',
    body: JSON.stringify({ text, count: photos.length, notes: notes.map((n) => ({ index: n.index, text: n.text })) })
  });
}

async function askQuestion({ text, photos = [], mode = null }) {
  const question = (text || '').trim();
  if (state.busy) return;
  if (!question && !photos.length) return;
  if (photos.length && !currentModel().vision) {
    toast('Фото понимает только DeepSeek Flash');
    return;
  }

  setBusy(true);
  setStatus('busy');
  state.lastQuestion = question;

  if (!mode) {
    addUserMessage(question, photos.map((p) => p.thumb));
    textBox.value = '';
    autosize();
  }

  const progress = addProgress(photos.length ? 'Распознаю фото…' : 'Думаю…');
  try {
    let data;
    if (photos.length) {
      data = await askWithPhotos(photos, question, progress);
    } else {
      data = await api('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ text: question, mode, threadId: state.threadId })
      });
    }
    progress.wrapper.remove();
    if (typeof data.spentToday === 'number') state.spentToday = data.spentToday;
    addBotMessage(data.text, metaLine(data));
  } catch (err) {
    progress.wrapper.remove();
    errorMessage(friendlyError(err));
    setStatus('error');
    console.error(err);
  } finally {
    setBusy(false);
    setTimeout(() => setStatus('ok'), 700);
  }
}

/* ---------- ввод ---------- */

function autosize() {
  textBox.style.height = 'auto';
  textBox.style.height = `${Math.min(textBox.scrollHeight, 132)}px`;
}

textBox.addEventListener('input', autosize);
textBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
});

function submit() {
  if (state.busy) return;
  const text = textBox.value.trim();
  const photos = state.attachments.slice();
  if (!text && !photos.length) return;
  state.attachments = [];
  renderTray();
  askQuestion({ text, photos });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});

photoBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = '';
  await addPhotos(files);
});

document.getElementById('trayClear').addEventListener('click', () => {
  state.attachments = [];
  renderTray();
});

feed.addEventListener('click', (event) => {
  const button = event.target.closest('[data-q]');
  if (button) {
    askQuestion({ text: button.dataset.q });
    return;
  }
});

/* ---------- чипы ---------- */

chips.addEventListener('click', async (event) => {
  const chipEl = event.target.closest('[data-chip]');
  if (!chipEl) return;
  const chip = chipEl.dataset.chip;

  if (chip === 'search') {
    const enabled = !chipEl.classList.contains('chip--on');
    chipEl.classList.toggle('chip--on', enabled);
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ search: enabled }) });
      toast(enabled ? 'Поиск включён: Дип решает сам' : 'Поиск выключен');
    } catch {
      chipEl.classList.toggle('chip--on', !enabled);
      toast('Не удалось переключить поиск');
    }
    return;
  }

  if (chip === 'reset') {
    try {
      await api('/api/reset', { method: 'POST' });
      state.lastQuestion = '';
      state.attachments = [];
      renderTray();
      showEmpty();
      toast('Диалог очищен');
    } catch {
      toast('Не удалось очистить');
    }
    return;
  }

  if (!state.lastQuestion) {
    toast('Сначала задай вопрос');
    return;
  }
  askQuestion({ text: state.lastQuestion, mode: chip });
});

/* ---------- настройки ---------- */

function openSheet(open) {
  sheet.dataset.open = open ? 'true' : 'false';
  sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
}

sheet.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) openSheet(false);
});

function renderFoot() {
  const foot = document.getElementById('sheetFoot');
  const parts = [];
  if (state.capUsd > 0) parts.push(`Сегодня $${state.spentToday.toFixed(4)} из $${state.capUsd}`);
  parts.push(currentModel().vision ? 'Фото: до 50 за раз' : 'Фото: только DeepSeek Flash');
  foot.textContent = parts.join(' · ');
}

document.getElementById('settingsBtn').addEventListener('click', async () => {
  openSheet(true);
  try {
    const data = await api('/api/settings');
    state.model = data.model || state.model;
    state.capUsd = typeof data.capUsd === 'number' ? data.capUsd : state.capUsd;
    for (const button of document.querySelectorAll('#styleSeg button')) {
      button.dataset.active = String(button.dataset.v === data.style);
    }
    renderModels();
    applyModelUi();
    renderFoot();
  } catch {
    toast('Настройки доступны только владельцу');
  }
});

document.getElementById('styleSeg').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  for (const other of document.querySelectorAll('#styleSeg button')) {
    other.dataset.active = String(other === button);
  }
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ style: button.dataset.v }) });
    toast('Стиль сохранён');
  } catch {
    toast('Не удалось сохранить стиль');
  }
});

document.getElementById('saveBtn').addEventListener('click', () => {
  openSheet(false);
});

/* ---------- чаты ---------- */

const chatsSheet = document.getElementById('chats');

function openChats(open) {
  chatsSheet.dataset.open = open ? 'true' : 'false';
  chatsSheet.setAttribute('aria-hidden', open ? 'false' : 'true');
}

async function loadThreads() {
  const list = document.getElementById('threadList');
  try {
    const data = await api('/api/threads');
    list.innerHTML = '';
    for (const thread of data.threads) {
      const row = document.createElement('div');
      row.className = 'thread';
      row.dataset.active = String(thread.id === data.active);
      row.innerHTML = '<div class="thread__body"><div class="thread__title"></div><div class="thread__date"></div></div><button class="thread__del" aria-label="Удалить">✕</button>';
      row.querySelector('.thread__title').textContent = thread.title;
      const date = new Date(thread.updatedAt * 1000);
      row.querySelector('.thread__date').textContent = `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      row.addEventListener('click', async (event) => {
        if (event.target.closest('.thread__del')) {
          await api(`/api/threads/${thread.id}`, { method: 'DELETE' });
          await loadThreads();
          return;
        }
        await openThread(thread.id);
      });
      list.appendChild(row);
    }
    if (!data.threads.length) {
      list.innerHTML = '<div class="hint">Чатов пока нет</div>';
    }
  } catch {
    list.innerHTML = '<div class="hint">Не удалось загрузить чаты</div>';
  }
}

async function openThread(threadId) {
  state.threadId = threadId;
  openChats(false);
  feed.innerHTML = '';
  const history = await api(`/api/history?thread=${threadId}`);
  const messages = history.messages || [];
  if (!messages.length) {
    feed.appendChild(buildEmpty());
  }
  for (const message of messages.slice(-30)) {
    if (message.role === 'user') {
      addUserMessage(message.text);
      state.lastQuestion = message.text;
    } else {
      addBotMessage(message.text, '');
    }
  }
  scrollDown(false);
}

document.getElementById('chatsBtn').addEventListener('click', async () => {
  openChats(true);
  await loadThreads();
});

chatsSheet.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) openChats(false);
});

document.getElementById('newChatBtn').addEventListener('click', async () => {
  const created = await api('/api/threads', { method: 'POST', body: JSON.stringify({}) });
  await openThread(created.id);
});

/* ---------- экран входа по ключу ---------- */

function showGate(message) {
  const gate = document.getElementById('gate');
  if (!gate) return;
  gate.dataset.open = 'true';
  document.getElementById('gateErr').textContent = message || '';
  setTimeout(() => document.getElementById('gateKey')?.focus(), 120);
}

function wireGate() {
  const button = document.getElementById('gateBtn');
  const input = document.getElementById('gateKey');
  if (!button || !input) return;
  const submitKey = () => {
    const key = input.value.trim();
    if (key.length < 16) {
      document.getElementById('gateErr').textContent = 'Ключ короткий — скопируй целиком из ссылки.';
      return;
    }
    localStorage.setItem('studyKey', key);
    location.reload();
  };
  button.addEventListener('click', submitKey);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitKey();
  });
}

/* ---------- запуск ---------- */

/** Отступ сверху под плавающие кнопки Telegram в полноэкранном режиме. */
function applyInsets() {
  const safe = Number(tg?.safeAreaInset?.top ?? 0);
  const content = Number(tg?.contentSafeAreaInset?.top ?? 0);
  // в полноэкранном режиме Telegram рисует свои кнопки поверх страницы:
  // если клиент не сообщил отступы, оставляем место под статус-бар iPhone
  const fallback = tg?.isFullscreen ? 46 : 0;
  const total = Math.max(safe, content, fallback);
  document.documentElement.style.setProperty('--tg-top', `${Math.min(total, 80)}px`);
}

async function boot() {
  wireGate();
  const url = new URL(location.href);
  const urlKey = url.searchParams.get('k');
  if (urlKey) {
    localStorage.setItem('studyKey', urlKey);
    url.searchParams.delete('k');
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  }
  state.appKey = localStorage.getItem('studyKey') || '';

  if (tg) {
    tg.ready();
    tg.expand();
    const supports = (version) => {
      try {
        return typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(version);
      } catch {
        return false;
      }
    };
    try {
      if (supports('8.0') && typeof tg.requestFullscreen === 'function') tg.requestFullscreen();
    } catch {}
    try {
      if (supports('7.7') && typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
    } catch {}
    try {
      if (supports('6.1')) {
        tg.setHeaderColor('#0b0b0e');
        tg.setBackgroundColor('#0b0b0e');
      }
    } catch {}
    applyInsets();
    try {
      tg.onEvent?.('safeAreaChanged', applyInsets);
      tg.onEvent?.('contentSafeAreaChanged', applyInsets);
    } catch {}
    state.initData = tg.initData || '';
  }

  if (!state.initData && !state.appKey) {
    showGate('Ключ нужен один раз — потом приложение помнит его само.');
    return;
  }

  renderModels();
  applyModelUi();

  try {
    const me = await api('/api/me');
    if (!me.allowed) {
      errorMessage('Нет доступа. Попроси владельца добавить твой аккаунт.');
      return;
    }
    if (Array.isArray(me.models) && me.models.length) state.models = me.models;
    state.model = me.model || state.model;
    state.spentToday = Number(me.costToday) || 0;
    state.capUsd = Number(me.capUsd) || 0;

    renderModels();
    applyModelUi();

    document.querySelector('[data-chip="search"]')?.classList.toggle('chip--on', me.search !== false);
    renderFoot();

    const history = await api('/api/history');
    const messages = history.messages || [];
    if (messages.length) {
      hideEmpty();
      for (const message of messages.slice(-20)) {
        if (message.role === 'user') {
          addUserMessage(message.text);
          state.lastQuestion = message.text;
        } else {
          addBotMessage(message.text, '');
        }
      }
      scrollDown(false);
    }
  } catch (err) {
    if (err.code === 'unauthorized') {
      if (state.appKey && !state.initData) {
        localStorage.removeItem('studyKey');
        state.appKey = '';
        showGate('Ключ не подошёл. Скопируй из ссылки ещё раз.');
      } else {
        errorMessage('Подпись Telegram не принята. Перезапусти приложение.');
      }
    } else {
      errorMessage('Не удалось загрузить историю.');
    }
  }
}

if (!document.getElementById('empty')) feed.appendChild(buildEmpty());
boot();
