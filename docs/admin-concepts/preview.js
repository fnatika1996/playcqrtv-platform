const $ = (selector, root = document) => root.querySelector(selector);
const preview = $('#preview');
const directionSelect = $('#direction');
const viewSelect = $('#view');
const viewportSelect = $('#viewport');

const iconFiles = {
  dashboard:'dashboard.svg', users:'users.svg', settings:'settings.svg', search:'search.svg', user:'user.svg',
  check:'check.svg', userCheck:'user-check.svg', userBlock:'user-block.svg', warning:'shield-warning.svg', shield:'shield-check.svg', mail:'letter-open.svg', lock:'lock.svg',
  login:'login.svg', loginAlt6:'login-alt-6.svg', logoutCurrent:'logout-current.svg', logout6:'logout-alt-6.svg', logout7:'logout-alt-7.svg',
  exit:'exit.svg', eye:'eye.svg', close:'close.svg'
};
const sourceDir = {
  dashboard: 'Settings Fine Tuning', users: 'Users', settings: 'Settings Fine Tuning', search: 'Search',
  user: 'Users', userCheck:'Users', userBlock:'Users', check: 'Essentional UI', warning: 'Security', shield: 'Security', mail: 'Messages Conversation',
  lock: 'Security', login: 'Arrows Action', logoutCurrent: 'Arrows Action', logout6: 'Arrows Action',
  logout7: 'Arrows Action', exit: 'Arrows Action', eye: 'Security', close: 'Essentional UI'
};
const iconTitles = {
  dashboard: ['Dashboard / Обзор', 'Widget--playcqrtv.svg'], users: ['Команда / Пользователи', 'Users-Group-Rounded--playcqrtv.svg'],
  settings: ['Настройки сайта', 'Settings-Minimalistic--playcqrtv.svg'], search: ['Поиск', 'Magnifer--playcqrtv.svg'],
  user: ['Профиль / администратор', 'User--playcqrtv.svg'], userCheck:['Активен / User-Check','User-Check--playcqrtv.svg'], userBlock:['Приостановлен / User-Block','User-Block--playcqrtv.svg'], check: ['Успешно / подтверждён', 'Check-Circle--playcqrtv.svg'],
  warning: ['Предупреждение', 'Shield-Warning--playcqrtv.svg'], shield: ['Защищённая сессия', 'Shield-Check--playcqrtv.svg'],
  mail: ['Email подтверждён', 'Letter-Opened--playcqrtv.svg'], lock: ['Закрытый доступ', 'Lock-Keyhole-Minimalistic--playcqrtv.svg'],
  login: ['Войти', 'Login--playcqrtv.svg'], loginAlt6: ['Войти · вариант 6', 'Login-6--playcqrtv.svg'],
  logoutCurrent: ['Текущий logout', 'Logout--playcqrtv.svg'], logout6: ['Кандидат logout · 6', 'Logout-6--playcqrtv.svg'],
  logout7: ['Кандидат logout · 7', 'Logout-7--playcqrtv.svg'], exit: ['Exit (выход/покинуть)', 'Exit--playcqrtv.svg'],
  eye: ['Показать пароль', 'Eye--playcqrtv.svg'], close: ['Закрыть / отмена', 'Close-Circle--playcqrtv.svg']
};

function icon(key, extra = '') { return `<img class="tiny-icon ${extra}" src="icons/${iconFiles[key] || `${key}.svg`}" alt="" aria-hidden="true">`; }
function mark() { return `<div class="brand-emblem" aria-hidden="true">C</div>`; }
function directionName(id) { return ({ a:'Premium Esports / Command Center', b:'Modern Operations Studio', c:'Futuristic Tactical Interface' })[id]; }
function nav(view) {
  const items = [['dashboard','dashboard','Обзор'],['users','users','Игроки'],['site','settings','Управление сайтом']];
  return `<nav class="nav" aria-label="Разделы концепта">${items.map(([id,ico,label])=>`<a href="#${id}" data-page="${id}" class="${view===id?'selected':''}">${icon(ico)}${label}</a>`).join('')}</nav>`;
}
function appFrame(view, body) {
  return `<div class="app-shell"><aside class="sidebar"><div class="brand">${mark()}<div><strong>CQRTV</strong><small>ADMIN OPERATIONS</small></div></div><div class="nav-label">ЦЕНТР УПРАВЛЕНИЯ</div>${nav(view)}<div class="sidebar-foot"><span class="secure-label">${icon('shield')} Сессия защищена</span><br>Макет · действия отключены</div></aside><section class="workspace"><header class="topbar"><button class="mobile-menu" type="button" aria-label="Меню концепта">☰</button><span class="topbar-title">CQRTV ADMIN / ${view.toUpperCase()}</span><span class="top-spacer"></span><span class="system-chip"><i class="dot"></i>РЕЖИМ ПРЕВЬЮ</span><span class="profile-chip"><i class="profile-dot">A</i><span>Администратор</span></span></header><main class="content">${body}</main><nav class="preview-nav-mobile" aria-label="Мобильная навигация">${[['dashboard','dashboard','Обзор'],['users','users','Игроки'],['site','settings','Сайт']].map(([id,ico,label])=>`<a href="#${id}" data-page="${id}">${icon(ico)}${label}</a>`).join('')}</nav></section></div>`;
}
function head(title, subtitle, badge = 'МАКЕТ · ДАННЫХ НЕТ') {
  return `<div class="content-head"><div><div class="eyebrow">CQRTV ADMIN · ${directionName(directionSelect.value).toUpperCase()}</div><h1>${title}</h1><p>${subtitle}</p></div><span class="demo-badge">${badge}</span></div>`;
}
function dashboard() {
  return `${head('Центр управления','Сводная информация и быстрый доступ к рабочим разделам.')}<section class="hero-strip"><div><div class="overline">ОПЕРАЦИОННАЯ СИСТЕМА CQRTV</div><h2>Управление платформой</h2><p>Концепция интерфейса панели. Все показатели оставлены пустыми до подключения реальных данных.</p></div><div class="hero-mark">${icon('shield')}</div></section><div class="metric-grid">${[['users','Игроки CQRTV'],['mail','Подтверждённые email'],['warning','Приостановлено']].map(([ico,label])=>`<article class="metric"><div class="metric-top">${icon(ico)}<span>${label}</span></div><strong>—</strong><small>Подключить статистику API</small></article>`).join('')}</div><section class="panel"><div class="panel-heading"><h2>Состояние системы</h2><span class="subtle">Источники статуса не подключены</span></div><div class="status-row">${[['API','Нет данных'],['PostgreSQL','Нет данных'],['Email / SMTP','Нет данных']].map(([label,value])=>`<div class="status-tile">${icon('shield')}<b>${label}</b><small>${value}</small></div>`).join('')}</div></section>`;
}
function users() {
  const rows = [['01','Пример игрока 01','player-•••@example.invalid','RU','AWPer','Подтверждён','Активен'],['02','Пример игрока 02','player-•••@example.invalid','KZ','Rifler','Ожидает','Активен'],['03','Пример игрока 03','player-•••@example.invalid','PL','IGL','Подтверждён','Пауза']];
  return `${head('Игроки CQRTV','Поиск, статусы и действия над аккаунтами — схема будущего раздела.','ПРИМЕР · НЕ РЕАЛЬНЫЕ АККАУНТЫ')}<section class="panel"><div class="toolbar"><span class="searchbox">${icon('search')}Ник или email</span><span class="filter-chip">Все статусы⌄</span><span class="filter-chip">Email: все⌄</span><span class="action-button">Фильтры</span></div><div class="table-wrap"><table><thead><tr><th>АККАУНТ</th><th>СТРАНА</th><th>РОЛЬ</th><th>EMAIL</th><th>СТАТУС</th><th>ДЕЙСТВИЯ</th></tr></thead><tbody>${rows.map(([id,nick,email,country,role,verified,status])=>`<tr><td><span class="user-name"><span class="avatar">${icon('user')}</span><span>${nick}<br><small class="micro">CQ-${id}</small></span></span></td><td>${country}</td><td>${role}</td><td>${verified}</td><td><span class="state-tag ${verified==='Ожидает'?'pending':''}">${status}</span></td><td><button class="row-action" type="button" aria-label="Действие для ${nick}" disabled>${icon('settings')}</button></td></tr>`).join('')}</tbody></table></div><p class="micro">Строки демонстрационные. Кнопки управления не выполняют действий.</p></section>`;
}
function site() {
  return `${head('Управление сайтом','Настройки режима работы и публичных ссылок CQRTV.','КОНЦЕПТ · ИЗМЕНЕНИЯ ОТКЛЮЧЕНЫ')}<div class="section-grid"><section class="panel"><div class="panel-heading"><h2>Режим сайта</h2><span class="subtle">Только схема</span></div><div class="mode-card"><div class="mode-card-head">${icon('shield')}<strong>Режим работы не подключён</strong></div><p class="hint">Показывает состояние из API. В концепте изменения невозможны.</p><div class="choice-row"><span class="choice">Открыт</span><span class="choice on">Превью</span><span class="choice">Техработы</span></div><span class="ghost-button" aria-disabled="true">Сохранение отключено</span></div></section><section class="panel"><div class="panel-heading"><h2>Публичные ссылки</h2><span class="subtle">Данные не загружены</span></div><div class="field"><label>Название площадки</label><div class="fake-input">CQRTV · пример настройки</div></div><div class="field"><label>Ссылка</label><div class="fake-input">https://example.invalid</div></div><span class="ghost-button" aria-disabled="true">Добавить ссылку</span></section></div><section class="panel"><div class="panel-heading"><h2>Фон и метаданные</h2><span class="subtle">Набросок структуры</span></div><div class="section-grid"><div class="field"><label>Фоновое изображение</label><div class="select-fake">PNG, JPEG или WebP · файл не выбран</div><small class="hint">Ограничения формата и размера остаются согласно рабочему API.</small></div><div class="field"><label>Описание страницы</label><div class="fake-input">Поле предварительного просмотра без сохранения</div></div></div></section>`;
}
function login() {
  return `<div class="login-stage"><section class="login-card"><div class="login-brand">${mark()}<div><strong>CQRTV</strong><small class="micro">ADMIN CONTROL ROOM</small></div></div><div class="eyebrow">ЗАЩИЩЁННЫЙ ДОСТУП</div><h1 class="login-title">Вход администратора</h1><p class="login-copy">Авторизуйтесь с подтверждённым аккаунтом, которому владелец CQRTV назначил доступ.</p><form class="concept-login"><label class="login-field"><span>Рабочий email</span><span class="login-input">${icon('mail')}<span>admin@example.com</span></span></label><label class="login-field"><span>Пароль</span><span class="login-input">${icon('lock')}<span>Введите пароль</span></span></label><button class="login-submit" type="button">${icon('login')}Войти в панель</button><div class="login-bottom"><span>Доступ выдаёт владелец CQRTV</span><span>Вернуться на сайт</span></div></form></section></div>`;
}
function render() {
  preview.dataset.direction = directionSelect.value;
  preview.dataset.view = viewSelect.value;
  preview.dataset.viewport = viewportSelect.value;
  const page = viewSelect.value;
  preview.innerHTML = page === 'login' ? login() : appFrame(page, page === 'users' ? users() : page === 'site' ? site() : dashboard());
  preview.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault(); viewSelect.value = link.dataset.page; history.replaceState(null,'',`?direction=${directionSelect.value}&view=${viewSelect.value}&viewport=${viewportSelect.value}`); render();
  }));
}
for (const control of [directionSelect, viewSelect, viewportSelect]) control.addEventListener('change', () => { history.replaceState(null,'',`?direction=${directionSelect.value}&view=${viewSelect.value}&viewport=${viewportSelect.value}`); render(); });
const query = new URLSearchParams(location.search);
if (['a','b','c'].includes(query.get('direction'))) directionSelect.value = query.get('direction');
if (['dashboard','users','site','login'].includes(query.get('view'))) viewSelect.value = query.get('view');
if (['desktop','mobile'].includes(query.get('viewport'))) viewportSelect.value = query.get('viewport');
$('#toggle-light').addEventListener('click', event => {
  const next = $('#icon-audit').dataset.light !== 'true';
  $('#icon-audit').dataset.light = String(next);
  event.currentTarget.setAttribute('aria-pressed',String(next));
  event.currentTarget.textContent = next ? 'Вернуться на тёмный фон' : 'Сравнить на светлом фоне';
});
render();

async function loadOriginalSvg(key) {
  const response = await fetch(`icons/${iconFiles[key]}`);
  if (!response.ok) throw new Error(`Не найдено: ${key}`);
  const xml = await response.text();
  if (/<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<!ENTITY\b|<\?xml-stylesheet\b|@import\b|url\(\s*["']?(?:https?:|\/\/)|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:|\/\/)/i.test(xml)) throw new Error(`Unsafe SVG source: ${key}`);
  const parsed = new DOMParser().parseFromString(xml,'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error(`Invalid SVG source: ${key}`);
  return { raw:`icons/${iconFiles[key]}`, normalized:xml.replaceAll('#000000','var(--icon-primary)').replaceAll('#737374','var(--icon-secondary)') };
}
const stateNames = [['normal','Обычное'],['active','Активное'],['hover','Наведение'],['disabled','Отключено'],['success','Успех'],['warning','Предупреждение'],['error','Ошибка']];
async function mountIconAudit() {
  const keys = Object.keys(iconTitles);
  const sources = Object.fromEntries(await Promise.all(keys.map(async key => [key, await loadOriginalSvg(key)])));
  $('#icon-grid').innerHTML = keys.map(key => {
    const [label, source] = iconTitles[key];
    return `<article class="icon-sample"><div><strong>${label}</strong><small>${source}<br>Архивная папка: ${sourceDir[key]}</small></div><div class="icon-box" title="Внешний img: исходные цвета"><img src="${sources[key].raw}" alt=""></div><div class="icon-box duo" title="Inline SVG: семантические цветовые токены"><span class="normalized" data-icon="${key}"></span></div></article>`;
  }).join('');
  for (const key of keys) {
    const parsed = new DOMParser().parseFromString(sources[key].normalized,'image/svg+xml');
    const svg = parsed.documentElement;
    svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('focusable','false');
    $('[data-icon="'+key+'"]')?.replaceChildren(document.importNode(svg,true));
  }
  const representative = ['users','shield','check','warning','logout6','login','mail'];
  $('#state-board').innerHTML = stateNames.map(([id,label]) => `<div class="state-label">${label}</div>${representative.map(key => `<div class="state-cell ${id}" aria-label="${label}"><span class="state-icon" data-state-icon="${key}"></span><span>${iconTitles[key][0].split(' /')[0]}</span></div>`).join('')}`).join('');
  for (const key of representative) {
    const parsed = new DOMParser().parseFromString(sources[key].normalized,'image/svg+xml');
    const svg = parsed.documentElement; svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('focusable','false');
    document.querySelectorAll(`[data-state-icon="${key}"]`).forEach(node => node.replaceChildren(document.importNode(svg,true)));
  }
}
mountIconAudit().catch(error => { $('#icon-grid').textContent = `Не удалось загрузить образцы: ${error.message}`; });
