const tg = window.Telegram?.WebApp;

// Статика может жить на GitHub Pages, а API — на воркере: тогда нужен абсолютный адрес.
const WORKER_URL = 'https://study-bot.vanya-study.workers.dev';
const WORKER_HOST = 'study-bot.vanya-study.workers.dev';
const API_BASE = location.hostname === WORKER_HOST ? '' : WORKER_URL;

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
function renderSamples() {
  const box = document.getElementById('samples');
  if (!box) return;
  box.innerHTML = '';
  const pool = [...SAMPLES].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const text of pool) {
    const b = document.createElement('button');
    b.className = 'sample';
    b.dataset.q = text;
    b.textContent = text;
    box.appendChild(b);
  }
}
const feed = document.getElementById('feed');
const empty = document.getElementById('empty');
const form = document.getElementById('form');
const textBox = document.getElementById('text');
const sendBtn = document.getElementById('sendBtn');
const chips = document.getElementById('chips');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');
const dot = document.getElementById('statusDot');
const modelLabel = document.getElementById('modelLabel');

const state = {
  initData: '',
  appKey: '',
  busy: false,
  lastQuestion: '',
  settings: null,
  lessonMode: false,
  searchMode: true,
  threadId: null,
};

/* ---------- инфраструктура ---------- */

function toast(message) {
  toastEl.textContent = message;
  toastEl.dataset.show = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toastEl.dataset.show = 'false';
  }, 2200);
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
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
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
  const safe = escapeHtml(text);
  return safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/* ---------- сообщения ---------- */

function hideEmpty() {
  if (empty && empty.parentElement) empty.remove();
}

function addUserMessage(text) {
  hideEmpty();
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg--user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  feed.appendChild(wrapper);
  scrollDown();
}

function addTyping() {
  hideEmpty();
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg--bot';
  wrapper.dataset.typing = 'true';
  wrapper.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  feed.appendChild(wrapper);
  scrollDown();
  return wrapper;
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
    ['Проще', 'simpler'],
  ]) {
    const button = document.createElement('button');
    button.className = 'ghost';
    button.textContent = label;
    button.addEventListener('click', () => ask(state.lastQuestion, mode));
    actions.appendChild(button);
  }
  const copy = document.createElement('button');
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

/* ---------- запрос ---------- */

async function ask(text, mode) {
  const question = (text ?? '').trim();
  if (!question || state.busy) return;

  state.busy = true;
  sendBtn.disabled = true;
  setStatus('busy');
  state.lastQuestion = question;

  if (!mode) {
    addUserMessage(question);
    textBox.value = '';
    autosize();
  }

  const typing = addTyping();
  try {
    const data = await api('/api/ask', { method: 'POST', body: JSON.stringify({ text: question, mode, threadId: state.threadId, model: state.pickedModel }) });
    typing.remove();
    const parts = [];
    if (data.searches) parts.push('поиск в интернете');
    if (data.ms) parts.push(`${(data.ms / 1000).toFixed(1)} с`);
    if (typeof data.cost === 'number') parts.push(`$${data.cost.toFixed(4)} за сегодня`);
    addBotMessage(data.text, parts.join(' · '));
    setStatus('ok');
  } catch (err) {
    typing.remove();
    const message = String(err.message || err);
    if (message.includes('unauthorized')) {
      errorMessage('Открой приложение через Telegram — без подписи доступ закрыт.');
    } else if (message.includes('forbidden')) {
      errorMessage('Нет доступа. Попроси владельца добавить тебя в список.');
    } else if (message.includes('баланс') || message.includes('402')) {
      errorMessage('На DeepSeek закончился баланс.');
    } else {
      errorMessage('Не получилось ответить. Попробуй ещё раз.');
      console.error(err);
    }
    setStatus('error');
  } finally {
    state.busy = false;
    sendBtn.disabled = false;
    setTimeout(() => setStatus('ok'), 600);
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
    ask(textBox.value);
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  ask(textBox.value);
});

document.getElementById('samples')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-q]');
  if (button) ask(button.dataset.q);
});

/* ---------- чипы ---------- */

chips.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-chip]');
  if (!button) return;
  const chip = button.dataset.chip;

  if (chip === 'search') {
    const searchChip = document.querySelector('[data-chip="search"]');
    const enabled = !(searchChip && searchChip.classList.contains('chip--on'));
    if (searchChip) searchChip.classList.toggle('chip--on', enabled);
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ searchMode: enabled ? 'auto' : 'off' }) });
      toast(enabled ? 'Поиск включён: бот решает сам' : 'Поиск выключен');
    } catch {
      if (searchChip) searchChip.classList.toggle('chip--on', !enabled);
      toast('Не удалось переключить поиск');
    }
    return;
  }

  if (chip === 'free') {
    const el = document.querySelector('[data-chip="free"]');
    const on = !(el && el.classList.contains('chip--on'));
    if (el) el.classList.toggle('chip--on', on);
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ freeMode: on }) });
      toast(on ? 'Свободный режим включён' : 'Свободный режим выключен');
    } catch {
      if (el) el.classList.toggle('chip--on', !on);
      toast('Не удалось переключить');
    }
    return;
  }

  if (chip === 'lesson') {
    state.lessonMode = !state.lessonMode;
    button.classList.toggle('chip--on', state.lessonMode);
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ lessonMode: state.lessonMode }) });
      toast(state.lessonMode ? 'Режим урока включён' : 'Режим урока выключен');
    } catch {
      toast('Не удалось изменить режим');
      state.lessonMode = !state.lessonMode;
      button.classList.toggle('chip--on', state.lessonMode);
    }
    return;
  }

  if (chip === 'reset') {
    try {
      await api('/api/reset', { method: 'POST' });
      feed.innerHTML = '';
      state.lastQuestion = '';
      const restored = empty.cloneNode(true);
      restored.id = 'empty';
      feed.appendChild(restored);
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
  ask(state.lastQuestion, chip);
});

/* ---------- настройки ---------- */

function openSheet(open) {
  sheet.dataset.open = open ? 'true' : 'false';
  sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
}

sheet.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) openSheet(false);
});

document.getElementById('settingsBtn').addEventListener('click', async () => {
  openSheet(true);
  try {
    const data = await api('/api/settings');
    state.settings = data;
    state.lessonMode = !!data.lessonMode;
    document.querySelectorAll('#styleSeg button').forEach((b) => {
      b.dataset.active = String(b.dataset.v === data.style);
    });
    document.querySelectorAll('#modelList button').forEach((b) => {
      b.dataset.active = String(b.dataset.v === data.model);
    });
    document.getElementById('sheetFoot').textContent = data.model === 'deepseek-v4-pro' ? 'Модель V4 Pro дороже в 3–4 раза' : '';
  } catch {
    toast('Настройки доступны только владельцу');
  }
});

for (const segment of ['styleSeg', 'modelList']) {
  document.getElementById(segment)?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    document.querySelectorAll(`#${segment} button`).forEach((b) => {
      b.dataset.active = String(b === button);
    });
  });
}

document.getElementById('lessonSwitch')?.addEventListener('click', (event) => {
  const next = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(next));
  state.lessonMode = next;
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const style = document.querySelector('#styleSeg button[data-active="true"]')?.dataset.v;
  const model = document.querySelector('#modelList button[data-active="true"]')?.dataset.v;
  state.pickedModel = model === 'glm-dan' ? 'glm-dan' : null;
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ style, model }),
    });
    modelLabel.textContent = model === 'deepseek-v4-pro' ? 'DeepSeek V4 Pro' : 'DeepSeek Flash';
    toast('Сохранено');
    openSheet(false);
  } catch {
    toast('Сохранять может только владелец');
  }
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
    state.activeThread = data.active;
    list.innerHTML = '';
    for (const thread of data.threads) {
      const row = document.createElement('div');
      row.className = 'thread';
      row.dataset.active = String(thread.id === data.active);
      const date = new Date(thread.updatedAt * 1000);
      row.innerHTML = `<div class="thread__body"><div class="thread__title"></div><div class="thread__date"></div></div><button class="thread__del" aria-label="Удалить">✕</button>`;
      row.querySelector('.thread__title').textContent = thread.title;
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
    const restored = empty.cloneNode(true);
    restored.id = 'empty';
    feed.appendChild(restored);
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
  const submit = () => {
    const key = input.value.trim();
    if (key.length < 16) {
      document.getElementById('gateErr').textContent = 'Ключ короткий — скопируй целиком из ссылки.';
      return;
    }
    localStorage.setItem('studyKey', key);
    location.reload();
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
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
    try {
      if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen();
      if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
    } catch {}
    try {
      tg.setHeaderColor('#0b0b0e');
      tg.setBackgroundColor('#0b0b0e');
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

  try {
    const me = await api('/api/me');
    if (!me.allowed) {
      errorMessage('Нет доступа. Попроси владельца добавить твой аккаунт.');
      return;
    }
    modelLabel.textContent = me.model === 'deepseek-v4-pro' ? 'DeepSeek V4 Pro' : 'DeepSeek Flash';
    state.lessonMode = !!me.lessonMode;
    state.searchMode = me.searchMode !== 'off';
    document.querySelector('[data-chip="free"]')?.classList.toggle('chip--on', !!me.freeMode);
    document.querySelector('[data-chip="search"]')?.classList.toggle('chip--on', state.searchMode);

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
    if (String(err.message).includes('unauthorized')) {
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

renderSamples();
boot();
