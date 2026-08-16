/**
 * Слот-машина фильмов — логика приложения.
 * Чистый JavaScript (ES6+), без фреймворков.
 */

'use strict';

/* =========================================================
   Вспомогательные функции
   ========================================================= */

/** Задержка для debounce. */
function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

/** Честный случайный индекс 0…max-1. */
function randomInt(max) {
    if (max <= 0) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
}

/** Экранирование текста для безопасной вставки в HTML. */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Год из даты TMDB (YYYY-MM-DD). */
function yearFromDate(dateStr) {
    if (!dateStr || dateStr.length < 4) return '';
    return dateStr.slice(0, 4);
}

/** Подпись типа: фильм / сериал / мультфильм. */
function mediaLabel(item) {
    const isAnim = Array.isArray(item.genre_ids) && item.genre_ids.includes(CONFIG.ANIMATION_GENRE_ID);
    if (isAnim) return 'мультфильм';
    if (item.media_type === 'tv') return 'сериал';
    return 'фильм';
}

/** CSS-класс бейджа по типу. */
function badgeClass(label) {
    if (label === 'мультфильм') return 'badge-anim';
    if (label === 'сериал') return 'badge-tv';
    return 'badge-movie';
}

/** URL постера или заглушка. */
function posterUrl(path, sizeBase = CONFIG.TMDB_IMAGE_BASE) {
    if (!path) return CONFIG.PLACEHOLDER_IMAGE;
    return `${sizeBase}${path}`;
}

/** Пользователь просит уменьшить анимации. */
function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* =========================================================
   Хранилище с graceful degradation
   ========================================================= */

class StorageService {
    constructor() {
        this.available = true;
        try {
            const probe = '__filmo_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
        } catch (err) {
            this.available = false;
            console.warn('localStorage недоступен, список будет храниться только в памяти.', err);
        }
        this.memory = {};
    }

    get(key, fallback) {
        try {
            if (this.available) {
                const raw = window.localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            }
        } catch (err) {
            console.warn('Не удалось прочитать localStorage:', err);
        }
        return Object.prototype.hasOwnProperty.call(this.memory, key)
            ? this.memory[key]
            : fallback;
    }

    set(key, value) {
        this.memory[key] = value;
        if (!this.available) return false;
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.warn('Не удалось записать localStorage:', err);
            this.available = false;
            return false;
        }
    }

    remove(key) {
        delete this.memory[key];
        if (!this.available) return;
        try {
            window.localStorage.removeItem(key);
        } catch (err) {
            console.warn('Не удалось очистить localStorage:', err);
        }
    }
}

/* =========================================================
   Уведомления
   ========================================================= */

class ToastManager {
    constructor(container) {
        this.container = container;
    }

    show(message, type = 'success', timeout = 2800) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', 'status');
        toast.textContent = message;
        this.container.appendChild(toast);
        window.setTimeout(() => {
            toast.remove();
        }, timeout);
    }
}

/* =========================================================
   Звук (Web Audio API, без файлов)
   ========================================================= */

class SoundManager {
    constructor() {
        this.enabled = true;
        this.ctx = null;
    }

    setEnabled(value) {
        this.enabled = Boolean(value);
    }

    ensureContext() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!this.ctx) {
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        return this.ctx;
    }

    /** Короткий тон. */
    beep(freq, time, duration, type = 'triangle', gainValue = 0.08) {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(gainValue, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
    }

    playClick() {
        if (!this.enabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        this.beep(420, ctx.currentTime, 0.07, 'square', 0.04);
    }

    playSpin() {
        if (!this.enabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        this.beep(180, ctx.currentTime, 0.18, 'sawtooth', 0.05);
        this.beep(240, ctx.currentTime + 0.08, 0.2, 'sawtooth', 0.04);
    }

    /** Победный сигнал — арпеджио. */
    playWin() {
        if (!this.enabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
            this.beep(freq, ctx.currentTime + i * 0.11, 0.28, 'triangle', 0.09);
        });
    }
}

/* =========================================================
   Поиск TMDB
   ========================================================= */

class MovieSearch {
    constructor(app) {
        this.app = app;
        this.input = document.getElementById('searchInput');
        this.dropdown = document.getElementById('searchResults');
        this.spinner = document.getElementById('searchSpinner');
        this.status = document.getElementById('searchStatus');
        this.results = [];
        this.activeIndex = -1;
        this.abortController = null;
        this.cache = new Map();

        this.onInput = debounce(() => this.handleQuery(), CONFIG.SEARCH_DEBOUNCE);
        this.input.addEventListener('input', this.onInput);
        this.input.addEventListener('keydown', (event) => this.onKeyDown(event));
        this.input.addEventListener('focus', () => {
            if (this.results.length) this.openDropdown();
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.search-section')) {
                this.closeDropdown();
            }
        });
    }

    isApiKeyReady() {
        const key = CONFIG.TMDB_API_KEY;
        return key && key !== 'YOUR_API_KEY_HERE';
    }

    setLoading(isLoading) {
        this.spinner.classList.toggle('hidden', !isLoading);
        this.input.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    }

    setStatus(text, isError = false) {
        this.status.textContent = text;
        this.status.classList.toggle('is-error', isError);
    }

    openDropdown() {
        this.dropdown.classList.remove('hidden');
        this.input.setAttribute('aria-expanded', 'true');
    }

    closeDropdown() {
        this.dropdown.classList.add('hidden');
        this.input.setAttribute('aria-expanded', 'false');
        this.activeIndex = -1;
    }

    async handleQuery() {
        const query = this.input.value.trim();
        if (query.length < CONFIG.MIN_QUERY_LENGTH) {
            this.results = [];
            this.dropdown.innerHTML = '';
            this.closeDropdown();
            this.setStatus('');
            return;
        }

        if (!this.isApiKeyReady()) {
            this.setStatus('Добавьте API-ключ TMDB в файл config.js', true);
            this.results = [];
            this.dropdown.innerHTML = '';
            this.closeDropdown();
            return;
        }

        const cacheKey = query.toLowerCase();
        if (this.cache.has(cacheKey)) {
            this.renderResults(this.cache.get(cacheKey));
            return;
        }

        this.setLoading(true);
        this.setStatus('Ищем…');

        try {
            const items = await this.search(query);
            this.cache.set(cacheKey, items);
            if (this.cache.size > 30) {
                const oldest = this.cache.keys().next().value;
                this.cache.delete(oldest);
            }
            this.renderResults(items);
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            this.renderError(err);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Два запроса (ru + en) объединяются по id, чтобы находить
     * названия на русском и английском. Повторяющиеся id отбрасываются.
     */
    async search(query) {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const [ruRes, enRes] = await Promise.allSettled([
            this.fetchLanguage(query, CONFIG.DEFAULT_LANGUAGE, signal),
            this.fetchLanguage(query, CONFIG.SECONDARY_LANGUAGE, signal)
        ]);

        const ru = ruRes.status === 'fulfilled' ? ruRes.value : [];
        const en = enRes.status === 'fulfilled' ? enRes.value : [];

        if (!ru.length && !en.length) {
            const reason = ruRes.status === 'rejected' ? ruRes.reason
                : enRes.status === 'rejected' ? enRes.reason
                    : null;
            if (reason) throw reason;
        }

        const merged = new Map();
        [...ru, ...en].forEach((item) => {
            if (!item || (item.media_type !== 'movie' && item.media_type !== 'tv')) return;
            const uid = `${item.media_type}-${item.id}`;
            if (!merged.has(uid)) merged.set(uid, item);
        });

        return Array.from(merged.values()).slice(0, CONFIG.MAX_RESULTS);
    }

    async fetchLanguage(query, language, signal) {
        const url = new URL(`${CONFIG.TMDB_BASE_URL}/search/multi`);
        url.searchParams.set('api_key', CONFIG.TMDB_API_KEY);
        url.searchParams.set('query', query);
        url.searchParams.set('language', language);
        url.searchParams.set('include_adult', 'false');
        url.searchParams.set('page', '1');

        let response;
        try {
            response = await fetch(url.toString(), { signal });
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            const error = new Error('network');
            error.cause = err;
            throw error;
        }

        if (response.status === 401) throw new Error('unauthorized');
        if (response.status === 429) throw new Error('rate_limit');
        if (!response.ok) throw new Error('api');

        const data = await response.json();
        return Array.isArray(data.results) ? data.results : [];
    }

    renderError(err) {
        this.results = [];
        this.dropdown.innerHTML = '';
        this.closeDropdown();
        const messages = {
            unauthorized: 'Неверный API-ключ TMDB. Проверьте config.js.',
            rate_limit: 'Превышен лимит запросов TMDB. Подождите немного.',
            network: 'Нет соединения. Проверьте интернет и попробуйте снова.',
            api: 'Ошибка API TMDB. Попробуйте позже.'
        };
        this.setStatus(messages[err.message] || 'Не удалось выполнить поиск.', true);
    }

    renderResults(items) {
        this.results = items;
        this.activeIndex = -1;
        this.dropdown.innerHTML = '';

        if (!items.length) {
            this.setStatus('Ничего не найдено. Попробуйте другое название.');
            this.closeDropdown();
            return;
        }

        items.forEach((item, index) => {
            this.dropdown.appendChild(this.createItem(item, index));
        });

        this.setStatus(`Найдено: ${items.length}`);
        this.openDropdown();
    }

    createItem(item, index) {
        const title = item.title || item.name || 'Без названия';
        const year = yearFromDate(item.release_date || item.first_air_date);
        const rating = typeof item.vote_average === 'number' && item.vote_average > 0
            ? item.vote_average.toFixed(1)
            : '—';
        const type = mediaLabel(item);
        const li = document.createElement('li');
        li.className = 'search-item';
        li.id = `search-option-${index}`;
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        li.dataset.index = String(index);

        const poster = posterUrl(item.poster_path, CONFIG.TMDB_IMAGE_SMALL);
        const imgHtml = item.poster_path
            ? `<img src="${escapeHtml(poster)}" alt="" width="46" height="68" loading="lazy" decoding="async">`
            : `<div class="search-placeholder" aria-hidden="true">🎬</div>`;

        li.innerHTML = `
            ${imgHtml}
            <div>
                <p class="search-item-title">${escapeHtml(title)}${year ? ` (${escapeHtml(year)})` : ''}</p>
                <p class="search-item-meta">★ ${escapeHtml(rating)}</p>
            </div>
            <span class="badge ${badgeClass(type)}">${escapeHtml(type)}</span>
        `;

        li.addEventListener('click', () => this.select(index));
        li.addEventListener('mousemove', () => this.setActive(index));
        return li;
    }

    setActive(index) {
        const options = this.dropdown.querySelectorAll('.search-item');
        options.forEach((el, i) => el.classList.toggle('is-active', i === index));
        this.activeIndex = index;
        if (options[index]) {
            this.input.setAttribute('aria-activedescendant', options[index].id);
            options[index].scrollIntoView({ block: 'nearest' });
        }
    }

    onKeyDown(event) {
        if (this.dropdown.classList.contains('hidden') && event.key !== 'ArrowDown') return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!this.results.length) return;
            this.openDropdown();
            this.setActive(Math.min(this.activeIndex + 1, this.results.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.setActive(Math.max(this.activeIndex - 1, 0));
        } else if (event.key === 'Enter') {
            if (this.activeIndex >= 0) {
                event.preventDefault();
                this.select(this.activeIndex);
            }
        } else if (event.key === 'Escape') {
            this.closeDropdown();
            this.input.blur();
        }
    }

    select(index) {
        const item = this.results[index];
        if (!item) return;
        this.app.list.addFromTmdb(item);
        this.input.value = '';
        this.results = [];
        this.dropdown.innerHTML = '';
        this.closeDropdown();
        this.setStatus('');
        this.input.focus();
    }
}

/* =========================================================
   Список фильмов пользователя
   ========================================================= */

class MovieList {
    constructor(app) {
        this.app = app;
        this.movies = [];
        this.container = document.getElementById('movieChips');
        this.countEl = document.getElementById('movieCount');
        this.emptyHint = document.getElementById('listEmptyHint');
        this.load();
        this.render();
    }

    load() {
        const saved = this.app.storage.get(CONFIG.STORAGE_KEY, []);
        this.movies = Array.isArray(saved) ? saved : [];
    }

    persist() {
        const ok = this.app.storage.set(CONFIG.STORAGE_KEY, this.movies);
        if (!ok) {
            this.app.toast.show('Не удалось сохранить список: хранилище недоступно.', 'error');
        }
    }

    uidOf(item) {
        return `${item.mediaType}-${item.id}`;
    }

    addFromTmdb(item) {
        const movie = {
            id: item.id,
            mediaType: item.media_type === 'tv' ? 'tv' : 'movie',
            title: item.title || item.name || 'Без названия',
            originalTitle: item.original_title || item.original_name || '',
            year: yearFromDate(item.release_date || item.first_air_date),
            rating: typeof item.vote_average === 'number' ? item.vote_average : 0,
            posterPath: item.poster_path || '',
            type: mediaLabel(item)
        };
        movie.uid = this.uidOf(movie);

        if (this.movies.some((m) => m.uid === movie.uid)) {
            this.app.toast.show('Этот фильм уже в списке', 'info');
            return false;
        }

        this.movies.push(movie);
        this.persist();
        this.render();
        this.app.slot.refreshIdleReel();
        this.app.updateSpinState();
        this.app.toast.show(`«${movie.title}» добавлен в список`, 'success');
        this.app.sound.playClick();
        return true;
    }

    remove(uid) {
        this.movies = this.movies.filter((m) => m.uid !== uid);
        this.persist();
        this.render();
        this.app.slot.refreshIdleReel();
        this.app.updateSpinState();
    }

    updateTitle(uid, title) {
        const movie = this.movies.find((m) => m.uid === uid);
        if (!movie) return;
        movie.title = title.trim() || movie.title;
        this.persist();
        this.render();
        this.app.slot.refreshIdleReel();
    }

    shuffle() {
        const copy = this.movies.slice();
        for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = randomInt(i + 1);
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        this.movies = copy;
        this.persist();
        this.render();
        this.app.slot.refreshIdleReel();
        this.app.toast.show('Список перемешан', 'info');
    }

    clear() {
        this.movies = [];
        this.persist();
        this.render();
        this.app.slot.refreshIdleReel();
        this.app.updateSpinState();
        this.app.hideResult();
    }

    render() {
        this.countEl.textContent = String(this.movies.length);
        this.emptyHint.classList.toggle('hidden', this.movies.length > 0);
        this.container.innerHTML = '';

        this.movies.forEach((movie) => {
            const chip = document.createElement('article');
            chip.className = 'movie-chip';
            chip.setAttribute('role', 'listitem');

            const src = posterUrl(movie.posterPath, CONFIG.TMDB_IMAGE_SMALL);
            const imgHtml = movie.posterPath
                ? `<img src="${escapeHtml(src)}" alt="" width="36" height="36" loading="lazy" decoding="async">`
                : `<div class="chip-placeholder" aria-hidden="true">🎬</div>`;

            chip.innerHTML = `
                ${imgHtml}
                <span class="chip-title" title="${escapeHtml(movie.title)}">${escapeHtml(movie.title)}</span>
                <button type="button" class="chip-btn edit" aria-label="Редактировать название «${escapeHtml(movie.title)}»">✎</button>
                <button type="button" class="chip-btn remove" aria-label="Удалить «${escapeHtml(movie.title)}»">×</button>
            `;

            chip.querySelector('.edit').addEventListener('click', () => {
                this.app.openEditDialog(movie.uid, movie.title);
            });
            chip.querySelector('.remove').addEventListener('click', () => {
                this.remove(movie.uid);
                this.app.toast.show('Фильм удалён из списка', 'info');
            });

            this.container.appendChild(chip);
        });
    }
}

/* =========================================================
   Слот-барабан
   ========================================================= */

class SlotMachine {
    constructor(app) {
        this.app = app;
        this.reel = document.getElementById('slotReel');
        this.frame = document.getElementById('slotFrame');
        this.windowEl = document.getElementById('slotWindow');
        this.isSpinning = false;
        this.refreshIdleReel();
    }

    itemHeight() {
        const styles = getComputedStyle(document.documentElement);
        const raw = styles.getPropertyValue('--reel-height').trim();
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : CONFIG.REEL_ITEM_HEIGHT;
    }

    createItem(movie, extraClass = '') {
        const el = document.createElement('div');
        el.className = `slot-item ${extraClass}`.trim();
        const src = posterUrl(movie.posterPath, CONFIG.TMDB_IMAGE_BASE);
        if (movie.posterPath) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = movie.title;
            img.width = 300;
            img.height = 400;
            img.decoding = 'async';
            img.loading = 'eager';
            img.onerror = () => {
                img.replaceWith(this.fallback(movie.title));
            };
            el.appendChild(img);
        } else {
            el.appendChild(this.fallback(movie.title));
        }
        return el;
    }

    fallback(title) {
        const div = document.createElement('div');
        div.className = 'item-fallback';
        div.textContent = title;
        return div;
    }

    refreshIdleReel() {
        if (this.isSpinning) return;
        this.reel.style.transition = 'none';
        this.reel.style.transform = 'translateY(0)';
        this.reel.innerHTML = '';
        const movies = this.app.list.movies;

        if (!movies.length) {
            const placeholder = document.createElement('div');
            placeholder.className = 'slot-placeholder';
            placeholder.textContent = 'Добавьте фильмы, чтобы крутить барабан';
            this.reel.appendChild(placeholder);
            return;
        }

        this.reel.appendChild(this.createItem(movies[movies.length - 1]));
    }

    preload(movies) {
        return Promise.all(movies.map((movie) => new Promise((resolve) => {
            if (!movie.posterPath) {
                resolve();
                return;
            }
            const img = new Image();
            img.onload = img.onerror = () => resolve();
            img.src = posterUrl(movie.posterPath, CONFIG.TMDB_IMAGE_BASE);
        })));
    }

    durationMs() {
        const speed = this.app.settings.spinSpeed || 'medium';
        return CONFIG.SPIN_SPEEDS[speed] || CONFIG.SPIN_DURATION;
    }

    async spin() {
        const movies = this.app.list.movies;
        if (this.isSpinning) return null;
        if (movies.length < CONFIG.MIN_MOVIES_REQUIRED) {
            this.app.toast.show(
                `Добавьте ещё минимум ${CONFIG.MIN_MOVIES_REQUIRED - movies.length} фильм(а), чтобы крутить барабан`,
                'error'
            );
            return null;
        }

        this.isSpinning = true;
        this.app.updateSpinState();
        this.frame.classList.add('is-spinning');
        this.frame.classList.remove('is-winner');
        this.app.hideResult();
        this.app.sound.playSpin();

        await this.preload(movies);

        const winnerIndex = randomInt(movies.length);
        const winner = movies[winnerIndex];
        const height = this.itemHeight();
        const loops = Math.max(6, Math.ceil(18 / movies.length));
        const strip = [];

        for (let i = 0; i < loops; i += 1) {
            strip.push(...movies);
        }
        strip.push(...movies);

        const targetIndex = loops * movies.length + winnerIndex;

        this.reel.style.transition = 'none';
        this.reel.style.transform = 'translateY(0)';
        this.reel.innerHTML = '';
        strip.forEach((movie, i) => {
            this.reel.appendChild(this.createItem(movie, i === targetIndex ? 'is-target' : ''));
        });

        const targetY = targetIndex * height;
        const duration = prefersReducedMotion() ? 400 : this.durationMs();

        void this.reel.offsetHeight;
        this.reel.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
        this.reel.style.transform = `translateY(-${targetY}px)`;

        await this.waitForStop(duration);

        const landed = this.reel.children[targetIndex];
        if (landed) landed.classList.add('winner');

        this.frame.classList.remove('is-spinning');
        this.frame.classList.add('is-winner');
        this.app.sound.playWin();
        this.app.showWinner(winner);

        window.setTimeout(() => {
            this.reel.style.transition = 'none';
            this.reel.innerHTML = '';
            const finalItem = this.createItem(winner, 'winner');
            this.reel.appendChild(finalItem);
            this.reel.style.transform = 'translateY(0)';
            this.frame.classList.remove('is-winner');
            this.isSpinning = false;
            this.app.updateSpinState();
        }, 900);

        return winner;
    }

    waitForStop(duration) {
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                this.reel.removeEventListener('transitionend', onEnd);
                resolve();
            };
            const onEnd = (event) => {
                if (event.propertyName === 'transform') finish();
            };
            this.reel.addEventListener('transitionend', onEnd);
            window.setTimeout(finish, duration + 80);
        });
    }
}

/* =========================================================
   Приложение
   ========================================================= */

class App {
    constructor() {
        this.storage = new StorageService();
        this.toast = new ToastManager(document.getElementById('toastContainer'));
        this.sound = new SoundManager();
        this.settings = this.loadSettings();
        this.sound.setEnabled(this.settings.sound);

        this.list = new MovieList(this);
        this.slot = new SlotMachine(this);
        this.search = new MovieSearch(this);

        this.spinBtn = document.getElementById('spinBtn');
        this.spinHint = document.getElementById('spinHint');
        this.settingsDialog = document.getElementById('settingsDialog');
        this.editDialog = document.getElementById('editDialog');
        this.editingUid = null;

        this.bindEvents();
        this.applySettingsToUi();
        this.updateSpinState();

        if (!this.storage.available) {
            this.toast.show('localStorage недоступен: список не сохранится после перезагрузки.', 'error', 5000);
        }

        this.registerServiceWorker();
    }

    loadSettings() {
        const defaults = { spinSpeed: 'medium', sound: true };
        const saved = this.storage.get(CONFIG.SETTINGS_KEY, defaults) || defaults;
        return {
            spinSpeed: CONFIG.SPIN_SPEEDS[saved.spinSpeed] ? saved.spinSpeed : 'medium',
            sound: saved.sound !== false
        };
    }

    saveSettings() {
        this.storage.set(CONFIG.SETTINGS_KEY, this.settings);
        this.sound.setEnabled(this.settings.sound);
    }

    applySettingsToUi() {
        const speedInput = this.settingsDialog.querySelector(`input[name="spinSpeed"][value="${this.settings.spinSpeed}"]`);
        if (speedInput) speedInput.checked = true;
        document.getElementById('soundToggle').checked = this.settings.sound;
    }

    bindEvents() {
        this.spinBtn.addEventListener('click', () => this.onSpin());

        document.getElementById('shuffleBtn').addEventListener('click', () => {
            if (this.list.movies.length < 2) {
                this.toast.show('Нечего перемешивать — добавьте больше фильмов.', 'info');
                return;
            }
            this.list.shuffle();
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            if (!this.list.movies.length) return;
            if (window.confirm('Очистить весь список фильмов?')) {
                this.list.clear();
                this.toast.show('Список очищен', 'info');
            }
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.applySettingsToUi();
            this.settingsDialog.showModal();
        });

        this.settingsDialog.querySelectorAll('input[name="spinSpeed"]').forEach((input) => {
            input.addEventListener('change', () => {
                this.settings.spinSpeed = input.value;
                this.saveSettings();
            });
        });

        document.getElementById('soundToggle').addEventListener('change', (event) => {
            this.settings.sound = event.target.checked;
            this.saveSettings();
            if (this.settings.sound) this.sound.playClick();
        });

        document.getElementById('resetBtn').addEventListener('click', () => {
            if (!window.confirm('Сбросить список фильмов и настройки?')) return;
            this.storage.remove(CONFIG.STORAGE_KEY);
            this.storage.remove(CONFIG.SETTINGS_KEY);
            this.settings = { spinSpeed: 'medium', sound: true };
            this.sound.setEnabled(true);
            this.list.clear();
            this.applySettingsToUi();
            this.saveSettings();
            this.toast.show('Все данные сброшены', 'info');
            this.settingsDialog.close();
        });

        document.getElementById('editForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const value = document.getElementById('editTitleInput').value.trim();
            if (this.editingUid && value) {
                this.list.updateTitle(this.editingUid, value);
                this.toast.show('Название обновлено', 'success');
            }
            this.editDialog.close();
        });

        document.getElementById('editCancelBtn').addEventListener('click', () => {
            this.editDialog.close();
        });

        window.addEventListener('resize', debounce(() => {
            if (!this.slot.isSpinning) this.slot.refreshIdleReel();
        }, 250));
    }

    openEditDialog(uid, title) {
        this.editingUid = uid;
        const input = document.getElementById('editTitleInput');
        input.value = title;
        this.editDialog.showModal();
        input.focus();
        input.select();
    }

    updateSpinState() {
        const count = this.list.movies.length;
        const need = CONFIG.MIN_MOVIES_REQUIRED;
        const spinning = this.slot.isSpinning;
        this.spinBtn.disabled = spinning || count < need;
        this.spinBtn.classList.toggle('is-busy', spinning);
        this.spinBtn.setAttribute('aria-disabled', this.spinBtn.disabled ? 'true' : 'false');

        if (spinning) {
            this.spinHint.textContent = 'Барабан крутится…';
        } else if (count < need) {
            const left = need - count;
            this.spinHint.textContent = `Добавьте ещё ${left} ${left === 1 ? 'фильм' : 'фильма'}, чтобы запустить барабан.`;
        } else {
            this.spinHint.textContent = 'Нажмите кнопку — победитель будет выбран случайно.';
        }
    }

    async onSpin() {
        if (this.spinBtn.disabled || this.slot.isSpinning) return;
        this.sound.playClick();
        try {
            await this.slot.spin();
        } catch (err) {
            console.error(err);
            this.toast.show('Не удалось запустить барабан.', 'error');
            this.slot.isSpinning = false;
        } finally {
            this.updateSpinState();
        }
    }

    hideResult() {
        const section = document.getElementById('resultSection');
        section.classList.add('hidden');
        section.classList.remove('pop-in');
    }

    showWinner(movie) {
        const section = document.getElementById('resultSection');
        const poster = document.getElementById('winnerPoster');
        const title = document.getElementById('winnerTitle');
        const meta = document.getElementById('winnerMeta');

        title.textContent = movie.title;
        const bits = [movie.year, movie.type];
        if (movie.rating) bits.push(`★ ${movie.rating.toFixed(1)}`);
        meta.textContent = bits.filter(Boolean).join(' · ');

        poster.src = posterUrl(movie.posterPath, CONFIG.TMDB_IMAGE_BASE);
        poster.alt = `Постер: ${movie.title}`;
        poster.onerror = () => {
            poster.src = CONFIG.PLACEHOLDER_IMAGE;
        };

        section.classList.remove('hidden');
        section.classList.remove('pop-in');
        void section.offsetWidth;
        section.classList.add('pop-in');
        section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }

    registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        if (!window.location.protocol.startsWith('http')) return;
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.warn('Service worker не зарегистрирован:', err);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.filmoApp = new App();
});
