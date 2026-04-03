const DEFAULT_BOOK_KEY = 'NCE1';
const PLAY_MODE_STORAGE_KEY = 'playMode';
const BOOK_SELECTION_STORAGE_KEY = 'selectedBookKey';

/** 与旧版一致：static/data.json，键为 "1"～"4"，每项 { title, filename }；资源路径为 NCE{n}/{filename}.mp3 与 .lrc（同旧版 lesson.js）。 */
const BOOK_DEFINITIONS = [
  {
    key: 'NCE1',
    dataKey: '1',
    bookPath: 'NCE1',
    title: 'NCE1 English Book',
    bookName: 'NCE1 English Book',
    bookLevel: 'First Things First',
    cover: 'images/NCE1.jpg'
  },
  {
    key: 'NCE2',
    dataKey: '2',
    bookPath: 'NCE2',
    title: 'NCE2 English Book',
    bookName: 'NCE2 English Book',
    bookLevel: 'Practice and Progress',
    cover: 'images/NCE2.jpg'
  },
  {
    key: 'NCE3',
    dataKey: '3',
    bookPath: 'NCE3',
    title: 'NCE3 English Book',
    bookName: 'NCE3 English Book',
    bookLevel: 'Developing Skills',
    cover: 'images/NCE3.jpg'
  },
  {
    key: 'NCE4',
    dataKey: '4',
    bookPath: 'NCE4',
    title: 'NCE4 English Book',
    bookName: 'NCE4 English Book',
    bookLevel: 'Fluency in English',
    cover: 'images/NCE4.jpg'
  }
];

/** 第一册每条对应两课：Lesson 1&2 …；其余册 Lesson 1 …（与旧版 book.js 课次对应） */
function lessonOrdinalLabel(dataKey, index) {
  if (dataKey === '1') {
    const a = index * 2 + 1;
    return `Lesson ${a}&${a + 1}`;
  }
  return `Lesson ${index + 1}`;
}

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class ReadingSystem {
  constructor() {
    this.state = {
      lessonData: null,
      books: [],
      units: [],
      bookPath: '',
      bookKey: '',
      currentLyrics: [],
      currentLyricIndex: -1,
      currentUnitIndex: -1,
      playMode: 'single',
      singlePlayEndTime: null,
      playbackRate: 1.0,
      translationMode: 'show',
      availableSpeeds: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
      savedPlayTime: 0,
      isProgressDragging: false
    };

    this.dom = {
      audioPlayer: qs('#audioPlayer'),
      lyricsDisplay: qs('#lyricsDisplay'),
      lyricsContainer: qs('.lyrics-container'),
      bookName: qs('#bookName'),
      bookLevel: qs('#bookLevel'),
      unitList: qs('#unitListContainer'),
      playModeBtn: qs('#playModeBtn'),
      playPauseBtn: qs('#playPauseBtn'),
      progressBar: qs('#progressBar'),
      currentTime: qs('#currentTime'),
      duration: qs('#duration'),
      speedBtn: qs('#speedBtn'),
      speedText: qs('#speedText'),
      bookCover: qs('#bookCover'),
      unitSelect: qs('#unitSelect'),
      unitSelectOpen: qs('#unitSelectOpen'),
      unitSelectOpenText: qs('#unitSelectOpenText'),
      unitSelectSheet: qs('#unitSelectSheet'),
      unitSelectSheetList: qs('#unitSelectSheetList'),
      bookSelects: qsa('.book-select'),
      prevUnitBtn: qs('#prevUnitBtn'),
      nextUnitBtn: qs('#nextUnitBtn'),
      toggleTranslationBtn: qs('#toggleTranslationBtn')
    };

    this.lyricLineEls = [];
    this.unitSelectBound = false;
    this.unitSelectSheetBound = false;
    this._sheetEscapeHandler = null;
    this.unitListBound = false;
    this.bookSelectsBound = false;
    this.lyricsBound = false;
    this.lrcCache = new Map();
    this.audioPreload = new Map();

    this.init();
  }

  async init() {
    await this.loadBooks();
    await this.applyBookFromHash();
    this.bindEvents();
    this.syncLessonPickerMode();
    window.addEventListener('resize', () => this.syncLessonPickerMode());
    this.loadPlayModePreference();
    this.updatePlayModeUI();
    this.loadTranslationPreference();
    this.updateTranslationToggle();
    await this.loadUnitFromStorage();
  }

  async loadBooks() {
    if (this.state.lessonData) return this.state.books;
    try {
      const response = await fetch('static/data.json');
      const data = await response.json();
      this.state.lessonData = data;
      this.state.books = BOOK_DEFINITIONS.filter(
        (def) => Array.isArray(data[def.dataKey]) && data[def.dataKey].length
      ).map((def) => ({
        key: def.key,
        bookPath: def.bookPath,
        title: def.title,
        bookName: def.bookName,
        bookLevel: def.bookLevel,
        cover: def.cover,
        dataKey: def.dataKey
      }));
    } catch (error) {
      console.error('加载课本数据失败:', error);
      this.state.lessonData = null;
      this.state.books = [];
    }
    return this.state.books;
  }

  resolveBookByKey(bookKey) {
    if (!this.state.books.length) return null;
    const exact = this.state.books.find((book) => book && book.key === bookKey);
    if (exact && exact.bookPath) return exact;
    const fallback = this.state.books.find((book) => book && book.key === DEFAULT_BOOK_KEY);
    if (fallback && fallback.bookPath) return fallback;
    return this.state.books.find((book) => book && book.bookPath) || null;
  }

  async applyBookFromHash() {
    const keyFromHash = location.hash.slice(1).trim();
    const storedBookKey = this.loadBookPreference();
    const initialBookKey = keyFromHash || storedBookKey || DEFAULT_BOOK_KEY;
    await this.applyBookChange(initialBookKey);
  }

  loadBookPreference() {
    return localStorage.getItem(BOOK_SELECTION_STORAGE_KEY)?.trim() || '';
  }

  persistBookPreference(bookKey) {
    if (!bookKey) return;
    localStorage.setItem(BOOK_SELECTION_STORAGE_KEY, bookKey);
  }

  async applyBookChange(bookKey) {
    await this.loadBooks();
    const resolved = this.resolveBookByKey(bookKey);

    if (!resolved || !resolved.bookPath) {
      this.state.bookPath = '';
      this.state.bookKey = '';
      this.renderEmptyState('未找到可用课本数据');
      return;
    }

    this.state.bookKey = resolved.key || bookKey;
    this.state.bookPath = resolved.bookPath.trim();
    this.persistBookPreference(this.state.bookKey);

    this.updateBookSelects();
    await this.loadBookConfig();
    this.renderUnitList();
    this.renderUnitSelect();
    this.resetUnitListScroll();
  }

  renderEmptyState(message) {
    if (this.dom.lyricsDisplay) {
      this.dom.lyricsDisplay.innerHTML = `<p class="placeholder">${message}</p>`;
    }
    if (this.dom.unitList) {
      this.dom.unitList.innerHTML = '';
    }
    if (this.dom.unitSelect) {
      this.dom.unitSelect.innerHTML = '<option value="">选择 Unit</option>';
    }
    if (this.dom.unitSelectSheetList) {
      this.dom.unitSelectSheetList.innerHTML = '';
    }
    if (this.dom.unitSelectOpen) {
      this.dom.unitSelectOpen.disabled = true;
    }
    this.updateUnitSelectOpenLabel();
    this.resetUnitListScroll();
  }

  resetUnitListScroll() {
    const scrollContainer = this.dom.unitList?.closest('.unit-list');
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }

  async loadBookConfig() {
    if (!this.state.bookPath || !this.state.lessonData) {
      this.renderEmptyState('未找到可用课本数据');
      return;
    }

    const resolved = this.resolveBookByKey(this.state.bookKey);
    if (!resolved || !resolved.dataKey) {
      this.renderEmptyState('未找到可用课本数据');
      return;
    }

    const lessons = this.state.lessonData[resolved.dataKey];
    if (!Array.isArray(lessons) || !lessons.length) {
      this.renderEmptyState('该册暂无课程数据');
      return;
    }

    const base = this.state.bookPath;
    const dk = resolved.dataKey;
    this.state.units = lessons.map((lesson, index) => {
      const ordinal = lessonOrdinalLabel(dk, index);
      return {
        title: lesson.title,
        displayTitle: `${ordinal} ${lesson.title}`,
        filename: lesson.filename,
        id: index + 1,
        audio: `${base}/${lesson.filename}.mp3`,
        lrc: `${base}/${lesson.filename}.lrc`
      };
    });

    if (this.dom.bookName) {
      this.dom.bookName.textContent = `《${resolved.bookName}》`;
    }
    if (this.dom.bookLevel) {
      this.dom.bookLevel.textContent = `${resolved.bookLevel}`;
    }
    if (this.dom.bookCover && resolved.cover) {
      this.dom.bookCover.src = resolved.cover;
    }
    this.lrcCache.clear();
    this.audioPreload.clear();
  }

  updateBookSelects() {
    if (!this.dom.bookSelects.length || !this.state.books.length) return;

    const options = this.state.books
      .filter((book) => book && book.key && book.title && book.bookPath)
      .map((book) => `<option value="${book.key}">${book.title}</option>`)
      .join('');

    this.dom.bookSelects.forEach((select) => {
      select.innerHTML = `${options}`;
      if (this.state.bookKey) {
        select.value = this.state.bookKey;
      }
    });
  }

  renderUnitList() {
    if (!this.dom.unitList) return;

    this.dom.unitList.innerHTML = this.state.units
      .map(
        (unit, index) => `
      <div class="unit-item" data-unit-index="${index}" tabindex="0" role="button" aria-label="打开 ${unit.displayTitle}">
        <h3>${unit.displayTitle}</h3>
      </div>
    `
      )
      .join('');
  }

  renderUnitSelect() {
    if (!this.dom.unitSelect) return;

    const options = this.state.units
      .map((unit, index) => `<option value="${index}">${unit.displayTitle}</option>`)
      .join('');

    this.dom.unitSelect.innerHTML = `${options}`;

    if (this.dom.unitSelectSheetList) {
      this.dom.unitSelectSheetList.innerHTML = this.state.units
        .map(
          (unit, index) =>
            `<li role="presentation"><button type="button" class="unit-select-sheet__item" data-unit-sheet-index="${index}">${unit.displayTitle}</button></li>`
        )
        .join('');
    }

    if (this.dom.unitSelectOpen) {
      this.dom.unitSelectOpen.disabled = !this.state.units.length;
    }
    this.updateUnitSelectOpenLabel();
    this.highlightUnitSheetActive();
  }

  updateUnitSelectOpenLabel() {
    if (!this.dom.unitSelectOpenText) return;
    const u = this.state.units[this.state.currentUnitIndex];
    this.dom.unitSelectOpenText.textContent = u ? u.displayTitle : '选择 Unit';
  }

  highlightUnitSheetActive() {
    if (!this.dom.unitSelectSheetList) return;
    const idx = this.state.currentUnitIndex;
    this.dom.unitSelectSheetList.querySelectorAll('.unit-select-sheet__item').forEach((btn) => {
      const i = parseInt(btn.dataset.unitSheetIndex, 10);
      btn.classList.toggle('is-active', i === idx);
    });
  }

  openUnitSelectSheet() {
    const sheet = this.dom.unitSelectSheet;
    const openBtn = this.dom.unitSelectOpen;
    if (!sheet || sheet.hidden === false) return;
    if (!openBtn || openBtn.disabled || !this.state.units.length) return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;

    this.highlightUnitSheetActive();
    sheet.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');

    this._sheetEscapeHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeUnitSelectSheet();
      }
    };
    document.addEventListener('keydown', this._sheetEscapeHandler);
  }

  closeUnitSelectSheet() {
    const sheet = this.dom.unitSelectSheet;
    const openBtn = this.dom.unitSelectOpen;
    if (sheet && !sheet.hidden) {
      sheet.hidden = true;
    }
    if (openBtn) {
      openBtn.setAttribute('aria-expanded', 'false');
    }
    if (this._sheetEscapeHandler) {
      document.removeEventListener('keydown', this._sheetEscapeHandler);
      this._sheetEscapeHandler = null;
    }
  }

  syncLessonPickerMode() {
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    const sel = this.dom.unitSelect;
    const openBtn = this.dom.unitSelectOpen;

    if (sel) {
      if (mobile) {
        sel.setAttribute('aria-hidden', 'true');
        sel.tabIndex = -1;
      } else {
        sel.removeAttribute('aria-hidden');
        sel.removeAttribute('tabindex');
        this.closeUnitSelectSheet();
      }
    }

    if (openBtn) {
      if (mobile) {
        openBtn.removeAttribute('aria-hidden');
        openBtn.removeAttribute('tabindex');
      } else {
        openBtn.setAttribute('aria-hidden', 'true');
        openBtn.tabIndex = -1;
      }
    }
  }

  async loadUnitFromStorage() {
    if (!this.state.units.length) return;

    const stored = localStorage.getItem(`${this.state.bookPath}/currentUnitIndex`);
    const parsed = stored ? parseInt(stored) : 0;
    const safeIndex = Number.isFinite(parsed)
      ? clamp(parsed, 0, this.state.units.length - 1)
      : 0;

    await this.loadUnitByIndex(safeIndex, { shouldScrollUnitIntoView: true });
  }

  async loadUnitByIndex(unitIndex, options = {}) {
    const { shouldScrollUnitIntoView = false } = options;

    this.state.currentUnitIndex = unitIndex;
    localStorage.setItem(`${this.state.bookPath}/currentUnitIndex`, unitIndex);

    const unit = this.state.units[unitIndex];
    if (!unit) return;

    this.resetPlayer();
    this.updateActiveUnit(unitIndex, { shouldScrollUnitIntoView });
    this.updateNavigationButtons();

    try {
      let lrcText = this.lrcCache.get(unit.lrc);
      if (!lrcText) {
        const response = await fetch(unit.lrc);
        lrcText = await response.text();
        this.lrcCache.set(unit.lrc, lrcText);
      }
      this.state.currentLyrics = LRCParser.parse(lrcText);
      this.renderLyrics();
    } catch (error) {
      console.error('加载歌词失败:', error);
      if (this.dom.lyricsDisplay) {
        this.dom.lyricsDisplay.innerHTML = '<p class="placeholder">加载失败</p>';
      }
    }

    if (this.dom.audioPlayer) {
      this.setPlayButtonDisabled(true);
      this.dom.audioPlayer.src = unit.audio;
      this.dom.audioPlayer.load();
    }

    this.loadPlayTime();
    this.loadSavedSpeed();
    this.prefetchUnit(unitIndex + 1);
  }

  resetPlayer() {
    if (this.dom.audioPlayer) {
      this.dom.audioPlayer.pause();
      this.dom.audioPlayer.currentTime = 0;
    }

    this.setPlayButtonDisabled(true);

    if (this.dom.progressBar) this.dom.progressBar.style.setProperty('--progress', '0%');
    if (this.dom.currentTime) this.dom.currentTime.textContent = '0:00';
    if (this.dom.duration) this.dom.duration.textContent = '0:00';

    this.updatePlayButton();
    this.state.currentLyricIndex = -1;
    this.state.singlePlayEndTime = null;
  }

  updateActiveUnit(unitIndex, options = {}) {
    const { shouldScrollUnitIntoView = false } = options;

    if (this.dom.unitList) {
      let activeItem = null;

      this.dom.unitList.querySelectorAll('.unit-item').forEach((item, index) => {
        if (index === unitIndex) {
          item.classList.add('active');
          activeItem = item;
        } else {
          item.classList.remove('active');
        }
      });

      if (activeItem && shouldScrollUnitIntoView) {
        activeItem.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }

    if (this.dom.unitSelect) {
      this.dom.unitSelect.value = unitIndex;
    }
    this.updateUnitSelectOpenLabel();
    this.highlightUnitSheetActive();
  }

  renderLyrics() {
    if (!this.dom.lyricsDisplay) return;

    if (this.dom.lyricsContainer) {
      this.dom.lyricsContainer.scrollTop = 0;
    }

    if (!this.state.currentLyrics.length) {
      this.dom.lyricsDisplay.innerHTML = '<p class="placeholder">没有歌词数据</p>';
      return;
    }

    this.dom.lyricsDisplay.innerHTML = this.state.currentLyrics
      .map(
        (lyric, index) => `
      <div class="lyric-line" data-index="${index}" data-time="${lyric.time}" tabindex="0" role="button" aria-label="播放第 ${index + 1} 句">
        <div class="lyric-text">${lyric.english}</div>
        ${lyric.chinese ? `<div class="lyric-translation">${lyric.chinese}</div>` : ''}
      </div>
    `
      )
      .join('');

    this.lyricLineEls = qsa('.lyric-line', this.dom.lyricsDisplay);
    this.state.currentLyricIndex = -1;
  }

  handleLyricActivate(line) {
    const index = parseInt(line.dataset.index);
    const time = parseFloat(line.dataset.time);
    this.playLyricAtIndex(index, time);
    this.persistPlayTime(time);
  }

  playLyricAtIndex(index, time) {
    if (!this.dom.audioPlayer) return;

    this.dom.audioPlayer.currentTime = time;

    if (this.state.playMode === 'single') {
      const nextLyric = this.state.currentLyrics[index + 1];
      this.state.singlePlayEndTime = nextLyric ? nextLyric.time : this.dom.audioPlayer.duration;
    } else {
      this.state.singlePlayEndTime = null;
    }

    this.dom.audioPlayer.play();
  }

  persistPlayTime(time) {
    localStorage.setItem(`${this.state.bookPath}/${this.state.currentUnitIndex}/playTime`, time);
  }

  checkSinglePlayEnd() {
    if (this.state.playMode !== 'single' || this.state.singlePlayEndTime === null || !this.dom.audioPlayer) {
      return;
    }

    const currentTime = this.dom.audioPlayer.currentTime;
    if (currentTime >= this.state.singlePlayEndTime && this.state.singlePlayEndTime !== this.dom.audioPlayer.duration) {
      this.dom.audioPlayer.pause();
      this.dom.audioPlayer.currentTime = this.state.singlePlayEndTime - 0.01;
      this.state.singlePlayEndTime = null;
    }
  }

  updateProgress() {
    if (!this.dom.progressBar || !this.dom.audioPlayer) return;

    if (this.dom.audioPlayer.duration && !this.state.isProgressDragging) {
      const percent = (this.dom.audioPlayer.currentTime / this.dom.audioPlayer.duration) * 100;
      this.dom.progressBar.style.setProperty('--progress', `${percent}%`);
      if (this.dom.currentTime) {
        this.dom.currentTime.textContent = this.formatTime(this.dom.audioPlayer.currentTime);
      }
    }
  }

  updateDuration() {
    if (!this.dom.audioPlayer) return;

    if (this.dom.duration) {
      this.dom.duration.textContent = this.formatTime(this.dom.audioPlayer.duration);
    }
    if (this.state.savedPlayTime > 0 && this.dom.audioPlayer.duration) {
      this.dom.audioPlayer.currentTime = Math.min(this.state.savedPlayTime, this.dom.audioPlayer.duration - 0.1);
      this.state.savedPlayTime = 0;
      this.updateProgress();
    }
  }

  updatePlayButton() {
    if (!this.dom.playPauseBtn || !this.dom.audioPlayer) return;

    if (this.dom.audioPlayer.paused) {
      this.dom.playPauseBtn.classList.remove('playing');
    } else {
      this.dom.playPauseBtn.classList.add('playing');
    }
  }

  setPlayButtonDisabled(disabled) {
    if (!this.dom.playPauseBtn) return;
    this.dom.playPauseBtn.disabled = disabled;
    this.dom.playPauseBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  cyclePlaybackSpeed() {
    const currentIndex = this.state.availableSpeeds.indexOf(this.state.playbackRate);
    const nextIndex = (currentIndex + 1) % this.state.availableSpeeds.length;
    this.state.playbackRate = this.state.availableSpeeds[nextIndex];

    if (this.dom.audioPlayer) {
      this.dom.audioPlayer.playbackRate = this.state.playbackRate;
    }

    this.updateSpeedButton();
    localStorage.setItem('playbackRate', this.state.playbackRate);
  }

  updateSpeedButton() {
    if (!this.dom.speedText || !this.dom.speedBtn) return;

    this.dom.speedText.textContent = `${this.state.playbackRate}x`;

    if (this.state.playbackRate !== 1.0) {
      this.dom.speedBtn.classList.add('active');
    } else {
      this.dom.speedBtn.classList.remove('active');
    }
  }

  loadPlayTime() {
    const time = localStorage.getItem(`${this.state.bookPath}/${this.state.currentUnitIndex}/playTime`);
    if (time) {
      const parsed = parseFloat(time);
      if (Number.isFinite(parsed)) {
        this.state.savedPlayTime = parsed;
      }
    }
  }

  loadSavedSpeed() {
    const savedSpeed = localStorage.getItem('playbackRate');
    if (savedSpeed) {
      const parsed = parseFloat(savedSpeed);
      if (!Number.isFinite(parsed)) return;
      this.state.playbackRate = parsed;
      if (this.dom.audioPlayer) {
        this.dom.audioPlayer.playbackRate = this.state.playbackRate;
      }
      this.updateSpeedButton();
    }
  }

  updateNavigationButtons() {
    if (this.dom.prevUnitBtn) {
      this.dom.prevUnitBtn.disabled = this.state.currentUnitIndex <= 0;
    }

    if (this.dom.nextUnitBtn) {
      this.dom.nextUnitBtn.disabled = this.state.currentUnitIndex >= this.state.units.length - 1;
    }
  }

  loadPreviousUnit() {
    if (this.state.currentUnitIndex > 0) {
      this.loadUnitByIndex(this.state.currentUnitIndex - 1);
    }
  }

  loadNextUnit() {
    if (this.state.currentUnitIndex < this.state.units.length - 1) {
      this.loadUnitByIndex(this.state.currentUnitIndex + 1);
    }
  }

  togglePlayMode() {
    this.state.playMode = this.state.playMode === 'single' ? 'continuous' : 'single';
    localStorage.setItem(PLAY_MODE_STORAGE_KEY, this.state.playMode);
    this.updatePlayModeUI();
  }

  updatePlayModeUI() {
    if (!this.dom.playModeBtn) return;

    if (this.state.playMode === 'single') {
      this.dom.playModeBtn.title = '单句点读';
      this.dom.playModeBtn.setAttribute('aria-label', '单句点读');
      this.dom.playModeBtn.setAttribute('aria-pressed', 'false');
      this.dom.playModeBtn.dataset.mode = 'single';
      this.dom.playModeBtn.classList.remove('continuous-mode');
    } else {
      this.dom.playModeBtn.title = '连续点读';
      this.dom.playModeBtn.setAttribute('aria-label', '连续点读');
      this.dom.playModeBtn.setAttribute('aria-pressed', 'true');
      this.dom.playModeBtn.dataset.mode = 'continuous';
      this.dom.playModeBtn.classList.add('continuous-mode');
    }
  }

  loadPlayModePreference() {
    const storedMode = localStorage.getItem(PLAY_MODE_STORAGE_KEY);
    if (storedMode === 'single' || storedMode === 'continuous') {
      this.state.playMode = storedMode;
    }
  }

  handleAudioEnded() {
    if (this.state.playMode === 'continuous') {
      this.playNextLyric();
    }
  }

  playNextLyric() {
    const nextIndex = this.state.currentLyricIndex + 1;
    if (nextIndex < this.state.currentLyrics.length && this.dom.audioPlayer) {
      const nextLyric = this.state.currentLyrics[nextIndex];
      this.dom.audioPlayer.currentTime = nextLyric.time;
      this.dom.audioPlayer.play();
    }
  }

  updateLyricHighlight() {
    if (!this.lyricLineEls.length || !this.dom.audioPlayer) return;

    const currentTime = this.dom.audioPlayer.currentTime;
    let newIndex = -1;
    for (let i = this.state.currentLyrics.length - 1; i >= 0; i--) {
      if (currentTime >= this.state.currentLyrics[i].time) {
        newIndex = i;
        break;
      }
    }

    if (newIndex === this.state.currentLyricIndex) return;

    if (this.state.currentLyricIndex >= 0 && this.lyricLineEls[this.state.currentLyricIndex]) {
      this.lyricLineEls[this.state.currentLyricIndex].classList.remove('active');
      this.lyricLineEls[this.state.currentLyricIndex].classList.remove('pulse');
    }

    this.state.currentLyricIndex = newIndex;

    if (newIndex >= 0) {
      const activeLine = this.lyricLineEls[newIndex];
      if (activeLine) {
        activeLine.classList.add('active');
        activeLine.classList.add('pulse');
        if (this.shouldScrollLyricIntoView(activeLine)) {
          activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }

  prefetchUnit(unitIndex) {
    const unit = this.state.units[unitIndex];
    if (!unit) return;

    if (unit.lrc && !this.lrcCache.has(unit.lrc)) {
      fetch(unit.lrc)
        .then((response) => response.text())
        .then((text) => this.lrcCache.set(unit.lrc, text))
        .catch(() => {});
    }

    if (unit.audio && !this.audioPreload.has(unit.audio)) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = unit.audio;
      this.audioPreload.set(unit.audio, audio);
    }
  }

  shouldScrollLyricIntoView(activeLine) {
    if (!this.dom.lyricsContainer) return true;
    const containerRect = this.dom.lyricsContainer.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();
    const topThreshold = containerRect.top + containerRect.height * 0.22;
    const bottomThreshold = containerRect.bottom - containerRect.height * 0.22;
    return lineRect.top < topThreshold || lineRect.bottom > bottomThreshold;
  }

  bindEvents() {
    this.bindBookSelects();
    this.bindUnitList();
    this.bindUnitSelect();
    this.bindUnitSelectSheet();
    this.bindLyrics();
    this.bindPlayerControls();
    this.bindNavigation();
    this.bindTranslationToggle();

    window.addEventListener('hashchange', () => {
      const newKey = location.hash.slice(1).trim() || DEFAULT_BOOK_KEY;
      if (newKey === this.state.bookKey) return;
      this.applyBookChange(newKey).then(() => this.loadUnitFromStorage());
    });
  }

  bindTranslationToggle() {
    if (!this.dom.toggleTranslationBtn) return;
    this.dom.toggleTranslationBtn.addEventListener('click', () => {
      const modes = ['show', 'hide', 'blur'];
      const currentIndex = modes.indexOf(this.state.translationMode);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
      this.state.translationMode = modes[nextIndex];
      localStorage.setItem('translationMode', this.state.translationMode);
      this.updateTranslationToggle();
    });
  }

  loadTranslationPreference() {
    const storedMode = localStorage.getItem('translationMode');
    if (storedMode === 'show' || storedMode === 'hide' || storedMode === 'blur') {
      this.state.translationMode = storedMode;
    }
  }

  updateTranslationToggle() {
    if (!this.dom.toggleTranslationBtn) return;
    const mode = this.state.translationMode;
    document.body.classList.toggle('hide-translation', mode === 'hide');
    document.body.classList.toggle('blur-translation', mode === 'blur');

    if (mode === 'show') {
      this.dom.toggleTranslationBtn.textContent = '中';
      this.dom.toggleTranslationBtn.setAttribute('aria-pressed', 'true');
      this.dom.toggleTranslationBtn.setAttribute('aria-label', '翻译显示');
    } else if (mode === 'blur') {
      this.dom.toggleTranslationBtn.textContent = '模';
      this.dom.toggleTranslationBtn.setAttribute('aria-pressed', 'mixed');
      this.dom.toggleTranslationBtn.setAttribute('aria-label', '翻译模糊显示');
    } else {
      this.dom.toggleTranslationBtn.textContent = '英';
      this.dom.toggleTranslationBtn.setAttribute('aria-pressed', 'false');
      this.dom.toggleTranslationBtn.setAttribute('aria-label', '仅显示英文');
    }
  }

  bindBookSelects() {
    if (this.bookSelectsBound || !this.dom.bookSelects.length) return;
    this.bookSelectsBound = true;

    this.dom.bookSelects.forEach((select) => {
      select.addEventListener('change', (event) => {
        const target = event.target;
        if (!target.value) return;
        if (location.hash.slice(1) === target.value) return;
        location.hash = target.value;
      });
    });
  }

  bindUnitList() {
    if (this.unitListBound || !this.dom.unitList) return;
    this.unitListBound = true;

    this.dom.unitList.addEventListener('click', (event) => {
      const item = event.target.closest('.unit-item');
      if (!item) return;
      const unitIndex = parseInt(item.dataset.unitIndex);
      this.loadUnitByIndex(unitIndex);
    });

    this.dom.unitList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('.unit-item');
      if (!item) return;
      event.preventDefault();
      const unitIndex = parseInt(item.dataset.unitIndex);
      this.loadUnitByIndex(unitIndex);
    });
  }

  bindUnitSelect() {
    if (this.unitSelectBound || !this.dom.unitSelect) return;
    this.unitSelectBound = true;

    this.dom.unitSelect.addEventListener('change', (event) => {
      const unitIndex = parseInt(event.target.value);
      if (unitIndex >= 0) {
        this.loadUnitByIndex(unitIndex);
      }
    });
  }

  bindUnitSelectSheet() {
    if (this.unitSelectSheetBound) return;
    const openBtn = this.dom.unitSelectOpen;
    const sheet = this.dom.unitSelectSheet;
    const list = this.dom.unitSelectSheetList;
    if (!openBtn || !sheet || !list) return;
    this.unitSelectSheetBound = true;

    openBtn.addEventListener('click', () => {
      this.openUnitSelectSheet();
    });

    sheet.querySelectorAll('[data-unit-sheet-dismiss]').forEach((el) => {
      el.addEventListener('click', () => this.closeUnitSelectSheet());
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.unit-select-sheet__item');
      if (!btn) return;
      const unitIndex = parseInt(btn.dataset.unitSheetIndex, 10);
      if (!Number.isFinite(unitIndex)) return;
      this.closeUnitSelectSheet();
      this.loadUnitByIndex(unitIndex);
    });
  }

  bindLyrics() {
    if (this.lyricsBound || !this.dom.lyricsDisplay) return;
    this.lyricsBound = true;

    this.dom.lyricsDisplay.addEventListener('click', (event) => {
      const line = event.target.closest('.lyric-line');
      if (!line) return;
      this.handleLyricActivate(line);
    });

    this.dom.lyricsDisplay.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const line = event.target.closest('.lyric-line');
      if (!line) return;
      event.preventDefault();
      this.handleLyricActivate(line);
    });
  }

  bindPlayerControls() {
    if (
      !this.dom.playPauseBtn ||
      !this.dom.speedBtn ||
      !this.dom.progressBar ||
      !this.dom.audioPlayer ||
      !this.dom.playModeBtn
    ) {
      return;
    }

    this.dom.playPauseBtn.addEventListener('click', () => {
      if (this.dom.audioPlayer.paused) {
        this.dom.audioPlayer.play();
      } else {
        this.dom.audioPlayer.pause();
      }
    });

    this.dom.speedBtn.addEventListener('click', () => {
      this.cyclePlaybackSpeed();
    });

    const seekByClientX = (clientX) => {
      if (!this.dom.audioPlayer.duration) return;
      const rect = this.dom.progressBar.getBoundingClientRect();
      const percent = clamp((clientX - rect.left) / rect.width, 0, 1);
      this.dom.audioPlayer.currentTime = percent * this.dom.audioPlayer.duration;
    };

    this.dom.progressBar.addEventListener('click', (event) => {
      seekByClientX(event.clientX);
    });

    this.dom.progressBar.addEventListener('pointerdown', (event) => {
      this.state.isProgressDragging = true;
      this.dom.progressBar.classList.add('dragging');
      this.dom.progressBar.setPointerCapture(event.pointerId);
      seekByClientX(event.clientX);
    });

    this.dom.progressBar.addEventListener('pointermove', (event) => {
      if (!this.state.isProgressDragging) return;
      seekByClientX(event.clientX);
    });

    this.dom.progressBar.addEventListener('pointerup', (event) => {
      this.state.isProgressDragging = false;
      this.dom.progressBar.classList.remove('dragging');
      this.dom.progressBar.releasePointerCapture(event.pointerId);
    });

    this.dom.progressBar.addEventListener('pointercancel', () => {
      this.state.isProgressDragging = false;
      this.dom.progressBar.classList.remove('dragging');
    });

    this.dom.progressBar.addEventListener('pointerleave', () => {
      this.state.isProgressDragging = false;
      this.dom.progressBar.classList.remove('dragging');
    });

    this.dom.playModeBtn.addEventListener('click', () => {
      this.togglePlayMode();
    });

    this.dom.audioPlayer.addEventListener('timeupdate', () => {
      this.checkSinglePlayEnd();
      this.updateLyricHighlight();
      this.updateProgress();
    });

    this.dom.audioPlayer.addEventListener('loadedmetadata', () => {
      this.updateDuration();
    });

    this.dom.audioPlayer.addEventListener('canplay', () => {
      this.setPlayButtonDisabled(false);
    });

    this.dom.audioPlayer.addEventListener('loadstart', () => {
      this.setPlayButtonDisabled(true);
    });

    this.dom.audioPlayer.addEventListener('ended', () => {
      this.handleAudioEnded();
      this.updatePlayButton();
    });

    this.dom.audioPlayer.addEventListener('play', () => {
      this.updatePlayButton();
    });

    this.dom.audioPlayer.addEventListener('pause', () => {
      this.state.singlePlayEndTime = null;
      this.updatePlayButton();
    });

    this.dom.audioPlayer.addEventListener('error', () => {
      this.setPlayButtonDisabled(true);
    });
  }

  bindNavigation() {
    if (this.dom.prevUnitBtn) {
      this.dom.prevUnitBtn.addEventListener('click', () => {
        this.loadPreviousUnit();
      });
    }

    if (this.dom.nextUnitBtn) {
      this.dom.nextUnitBtn.addEventListener('click', () => {
        this.loadNextUnit();
      });
    }
  }
}

// 初始化系统
document.addEventListener('DOMContentLoaded', () => {
  new ReadingSystem();
  initThemeToggle();
});

// 主题切换功能
function initThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  if (!themeToggle) return;

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark' || (!savedTheme && prefersDark.matches)) {
    document.body.classList.add('dark-theme');
  }

  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');

    themeToggle.style.transform = 'rotate(360deg)';
    setTimeout(() => {
      themeToggle.style.transform = '';
    }, 300);
  });

  prefersDark.addEventListener('change', (event) => {
    if (!localStorage.getItem('theme')) {
      if (event.matches) {
        document.body.classList.add('dark-theme');
      } else {
        document.body.classList.remove('dark-theme');
      }
    }
  });
}


// LRC 解析器
class LRCParser {
  static parse(lrcText) {
    const lines = lrcText.split('\n');
    const lyrics = [];

    for (const line of lines) {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.+)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = parseInt(match[3]);
        const time = minutes * 60 + seconds + milliseconds / 1000 - 0.5;

        // 分割英文和中文（使用 | 分隔符）
        const text = match[4].trim();
        const parts = text.split('|').map((p) => p.trim());

        lyrics.push({
          time,
          english: parts[0] || '',
          chinese: parts[1] || '',
          fullText: text
        });
      }
    }

    return lyrics.sort((a, b) => a.time - b.time);
  }
}
