/**
 * MangaVerse - Built-in Manga Reader Engine
 * Supports Webtoon continuous scroll, Single Page flip mode, keyboard/touch navigation,
 * quality switching, and real-time progress tracking.
 */

import { MangaAPI } from './api.js';
import { State } from './state.js';

export const Reader = {
  activeManga: null,
  activeChapter: null,
  allChapters: [],
  pageUrls: [],
  saverUrls: [],
  currentPage: 1,
  totalPages: 1,
  mode: 'webtoon', // 'webtoon' | 'single'
  quality: 'high', // 'high' | 'saver'
  direction: 'ltr', // 'ltr' | 'rtl'
  controlsVisible: true,
  hideControlsTimeout: null,
  intersectionObserver: null,

  init() {
    this.container = document.getElementById('view-reader');
    this.header = document.getElementById('reader-header');
    this.footer = document.getElementById('reader-footer');
    this.canvas = document.getElementById('reader-canvas');
    this.pageSlider = document.getElementById('reader-page-slider');
    this.pageCounter = document.getElementById('reader-page-counter');
    this.chapterDrawer = document.getElementById('reader-chapter-drawer');

    // Load initial settings
    const settings = State.getSettings();
    this.mode = settings.readerMode || 'webtoon';
    this.quality = settings.imageQuality || 'high';
    this.direction = settings.readingDirection || 'ltr';

    this.bindEvents();
  },

  bindEvents() {
    // Canvas interaction to toggle controls
    this.canvas.addEventListener('click', (e) => {
      // Don't toggle controls if clicking hotspots or buttons
      if (e.target.closest('.single-nav-hotspot') || e.target.closest('button') || e.target.closest('.chapter-end-card')) return;
      this.toggleControls();
    });

    // Mouse movement reveals controls
    this.canvas.addEventListener('mousemove', () => {
      this.showControls();
    });

    // Scroll resets controls timer
    this.canvas.addEventListener('scroll', () => {
      if (this.mode === 'webtoon') {
        this.resetControlsTimer();
      }
    });

    // Page range slider
    if (this.pageSlider) {
      this.pageSlider.addEventListener('input', (e) => {
        const page = parseInt(e.target.value, 10);
        this.goToPage(page);
      });
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;

      if (e.key === 'ArrowRight' || e.key === 'd') {
        if (this.direction === 'rtl') this.prevPage();
        else this.nextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        if (this.direction === 'rtl') this.nextPage();
        else this.prevPage();
      } else if (e.key === 'f' || e.key === 'F') {
        this.toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (this.isDrawerOpen()) {
          this.closeDrawer();
        } else {
          this.close();
        }
      } else if (e.key === 'm' || e.key === 'M') {
        this.toggleMode();
      }
    });

    // Touch swipe handling for single page mode
    let touchStartX = 0;
    let touchStartY = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    this.canvas.addEventListener('touchend', (e) => {
      if (this.mode !== 'single') return;
      const touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;

      // Ensure horizontal swipe
      if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) {
          // Swiped left
          if (this.direction === 'rtl') this.prevPage();
          else this.nextPage();
        } else {
          // Swiped right
          if (this.direction === 'rtl') this.nextPage();
          else this.prevPage();
        }
      }
    }, { passive: true });
  },

  isOpen() {
    return this.container && this.container.classList.contains('active');
  },

  isDrawerOpen() {
    return this.chapterDrawer && this.chapterDrawer.classList.contains('open');
  },

  async openChapter({ manga, chapter, allChapters = [] }) {
    this.activeManga = manga;
    this.activeChapter = chapter;
    this.allChapters = allChapters.length > 0 ? allChapters : [chapter];
    this.currentPage = 1;

    // Show reader container
    this.container.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Update Header labels
    const mangaTitleEl = document.getElementById('reader-manga-title');
    const chapTitleEl = document.getElementById('reader-chapter-title');
    if (mangaTitleEl) mangaTitleEl.textContent = MangaAPI.resolveTitle(manga);
    if (chapTitleEl) {
      const chapNum = chapter.attributes?.chapter ? `Ch. ${chapter.attributes.chapter}` : 'Chapter';
      const chapName = chapter.attributes?.title ? ` - ${chapter.attributes.title}` : '';
      chapTitleEl.textContent = `${chapNum}${chapName}`;
    }

    this.showControls();
    this.updateControlsUI();
    this.populateDrawer();

    // Show loading state
    this.canvas.innerHTML = `
      <div style="min-height: 80vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.25rem;">
        <div class="spinner" style="width: 44px; height: 44px; border-width: 4px;"></div>
        <p style="color: var(--text-muted); font-size: 1.05rem; font-weight: 500;">
          Connecting to MangaDex server & loading pages...
        </p>
      </div>
    `;

    try {
      const pageData = await MangaAPI.getChapterPages(chapter.id);
      this.pageUrls = pageData.highQualityUrls;
      this.saverUrls = pageData.dataSaverUrls;
      this.totalPages = this.pageUrls.length || this.saverUrls.length || 1;

      // Update Slider bounds
      if (this.pageSlider) {
        this.pageSlider.min = 1;
        this.pageSlider.max = this.totalPages;
        this.pageSlider.value = 1;
      }
      this.updatePageCounter();

      // Check for saved progress on this chapter
      const history = State.getHistoryForManga(manga.id);
      if (history && history.chapterId === chapter.id && history.page > 1 && history.page <= this.totalPages) {
        this.currentPage = history.page;
      }

      // Record reading history
      State.saveHistory({
        mangaId: manga.id,
        mangaTitle: MangaAPI.resolveTitle(manga),
        cover: MangaAPI.resolveCoverUrl(manga, '256'),
        chapterId: chapter.id,
        chapterNum: chapter.attributes?.chapter || '1',
        chapterTitle: chapter.attributes?.title || '',
        page: this.currentPage,
        totalPages: this.totalPages
      });

      this.render();
    } catch (err) {
      console.error('Failed to load chapter pages:', err);
      this.canvas.innerHTML = `
        <div class="reader-img-error" style="position: relative; max-width: 500px; margin: auto; padding: 3rem 1.5rem;">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <h3 style="font-size: 1.25rem; font-weight: 700; color: white;">Failed to Load Chapter Pages</h3>
          <p style="color: var(--text-muted); font-size: 0.92rem;">
            ${err.message || 'This chapter may be externally licensed or temporarily unavailable.'}
          </p>
          <div style="display: flex; gap: 0.75rem; margin-top: 1rem;">
            <button class="btn btn-primary btn-sm" id="reader-retry-btn">Retry Loading</button>
            <button class="btn btn-secondary btn-sm" id="reader-error-close-btn">Close Reader</button>
          </div>
        </div>
      `;

      document.getElementById('reader-retry-btn')?.addEventListener('click', () => {
        this.openChapter({ manga, chapter, allChapters });
      });
      document.getElementById('reader-error-close-btn')?.addEventListener('click', () => {
        this.close();
      });
    }
  },

  getCurrentPageUrls() {
    return this.quality === 'saver' && this.saverUrls.length > 0 ? this.saverUrls : this.pageUrls;
  },

  render() {
    if (this.mode === 'webtoon') {
      this.renderWebtoonMode();
    } else {
      this.renderSinglePageMode();
    }
  },

  renderWebtoonMode() {
    const urls = this.getCurrentPageUrls();
    this.canvas.innerHTML = '';

    const stream = document.createElement('div');
    stream.className = 'reader-webtoon-stream';

    urls.forEach((url, index) => {
      const pageNum = index + 1;
      const pageWrap = document.createElement('div');
      pageWrap.className = 'reader-page-wrap';
      pageWrap.dataset.page = pageNum;
      pageWrap.id = `reader-page-${pageNum}`;

      const loader = document.createElement('div');
      loader.className = 'reader-img-loading';
      loader.innerHTML = `
        <div class="spinner"></div>
        <span>Page ${pageNum}</span>
      `;

      const img = document.createElement('img');
      img.className = 'reader-img';
      img.alt = `Page ${pageNum}`;
      img.loading = index < 3 ? 'eager' : 'lazy';

      img.onload = () => {
        loader.remove();
      };

      img.onerror = () => {
        loader.remove();
        pageWrap.innerHTML = `
          <div class="reader-img-error">
            <p>Failed to load page ${pageNum}</p>
            <button class="btn btn-secondary btn-sm" onclick="this.closest('.reader-page-wrap').querySelector('img').src = '${url}?t=' + Date.now();">
              Reload Page
            </button>
          </div>
        `;
      };

      img.src = url;
      pageWrap.appendChild(loader);
      pageWrap.appendChild(img);
      stream.appendChild(pageWrap);
    });

    // End of chapter card
    const endCard = this.createEndChapterCard();
    stream.appendChild(endCard);

    this.canvas.appendChild(stream);
    this.setupWebtoonObserver();

    // Scroll to initial page if not page 1
    if (this.currentPage > 1) {
      setTimeout(() => {
        const targetEl = document.getElementById(`reader-page-${this.currentPage}`);
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  },

  setupWebtoonObserver() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    const options = {
      root: this.canvas,
      rootMargin: '0px',
      threshold: 0.3
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.dataset.page) {
          const page = parseInt(entry.target.dataset.page, 10);
          this.currentPage = page;
          this.updatePageCounter();
          if (this.pageSlider) this.pageSlider.value = page;

          // Save progress
          State.saveHistory({
            mangaId: this.activeManga.id,
            mangaTitle: MangaAPI.resolveTitle(this.activeManga),
            cover: MangaAPI.resolveCoverUrl(this.activeManga, '256'),
            chapterId: this.activeChapter.id,
            chapterNum: this.activeChapter.attributes?.chapter || '1',
            chapterTitle: this.activeChapter.attributes?.title || '',
            page: this.currentPage,
            totalPages: this.totalPages
          });
        }
      });
    }, options);

    const pages = this.canvas.querySelectorAll('.reader-page-wrap');
    pages.forEach(p => this.intersectionObserver.observe(p));
  },

  renderSinglePageMode() {
    const urls = this.getCurrentPageUrls();
    const currentUrl = urls[this.currentPage - 1];
    this.canvas.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'reader-single-page-wrap';

    // Left hotspot
    const leftHotspot = document.createElement('div');
    leftHotspot.className = 'single-nav-hotspot hotspot-left';
    leftHotspot.innerHTML = `
      <div class="hotspot-arrow">
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </div>
    `;
    leftHotspot.onclick = (e) => {
      e.stopPropagation();
      if (this.direction === 'rtl') this.nextPage();
      else this.prevPage();
    };

    // Right hotspot
    const rightHotspot = document.createElement('div');
    rightHotspot.className = 'single-nav-hotspot hotspot-right';
    rightHotspot.innerHTML = `
      <div class="hotspot-arrow">
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    `;
    rightHotspot.onclick = (e) => {
      e.stopPropagation();
      if (this.direction === 'rtl') this.prevPage();
      else this.nextPage();
    };

    // Main image
    const img = document.createElement('img');
    img.className = 'reader-single-img';
    img.alt = `Page ${this.currentPage}`;
    img.src = currentUrl;

    wrap.appendChild(leftHotspot);
    wrap.appendChild(img);
    wrap.appendChild(rightHotspot);

    this.canvas.appendChild(wrap);
    this.updatePageCounter();
    if (this.pageSlider) this.pageSlider.value = this.currentPage;
  },

  createEndChapterCard() {
    const nextChap = this.getNextChapter();
    const card = document.createElement('div');
    card.className = 'chapter-end-card';

    const chapNum = this.activeChapter.attributes?.chapter || '1';
    card.innerHTML = `
      <div class="chapter-end-icon">
        <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <h3 class="chapter-end-title">Finished Chapter ${chapNum}!</h3>
      <p class="chapter-end-sub">
        ${nextChap ? `Next up: Chapter ${nextChap.attributes?.chapter || 'Next'}` : 'You are all caught up on available chapters for this series!'}
      </p>
      <div class="chapter-end-buttons">
        ${nextChap ? `
          <button class="btn btn-primary" id="end-card-next-btn">
            Read Next Chapter (${nextChap.attributes?.chapter})
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        ` : ''}
        <button class="btn btn-secondary" id="end-card-back-btn">
          Back to Manga
        </button>
      </div>
    `;

    card.querySelector('#end-card-next-btn')?.addEventListener('click', () => {
      if (nextChap) {
        this.openChapter({ manga: this.activeManga, chapter: nextChap, allChapters: this.allChapters });
      }
    });

    card.querySelector('#end-card-back-btn')?.addEventListener('click', () => {
      this.close();
    });

    return card;
  },

  goToPage(page) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updatePageCounter();
    if (this.pageSlider) this.pageSlider.value = page;

    if (this.mode === 'webtoon') {
      const el = document.getElementById(`reader-page-${page}`);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    } else {
      this.renderSinglePageMode();
    }
  },

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.goToPage(this.currentPage + 1);
    } else {
      const nextChap = this.getNextChapter();
      if (nextChap && confirm(`End of Chapter reached. Proceed to Chapter ${nextChap.attributes?.chapter || 'Next'}?`)) {
        this.openChapter({ manga: this.activeManga, chapter: nextChap, allChapters: this.allChapters });
      }
    }
  },

  prevPage() {
    if (this.currentPage > 1) {
      this.goToPage(this.currentPage - 1);
    } else {
      const prevChap = this.getPrevChapter();
      if (prevChap && confirm(`Go back to previous Chapter ${prevChap.attributes?.chapter || 'Previous'}?`)) {
        this.openChapter({ manga: this.activeManga, chapter: prevChap, allChapters: this.allChapters });
      }
    }
  },

  getNextChapter() {
    const idx = this.allChapters.findIndex(c => c.id === this.activeChapter.id);
    if (idx >= 0 && idx < this.allChapters.length - 1) {
      return this.allChapters[idx + 1];
    }
    return null;
  },

  getPrevChapter() {
    const idx = this.allChapters.findIndex(c => c.id === this.activeChapter.id);
    if (idx > 0) {
      return this.allChapters[idx - 1];
    }
    return null;
  },

  updatePageCounter() {
    if (this.pageCounter) {
      this.pageCounter.textContent = `${this.currentPage} / ${this.totalPages}`;
    }
  },

  toggleControls() {
    this.controlsVisible = !this.controlsVisible;
    if (this.controlsVisible) {
      this.showControls();
    } else {
      this.hideControls();
    }
  },

  showControls() {
    this.controlsVisible = true;
    this.header?.classList.remove('hidden');
    this.footer?.classList.remove('hidden');
    this.resetControlsTimer();
  },

  hideControls() {
    if (this.isDrawerOpen()) return;
    this.controlsVisible = false;
    this.header?.classList.add('hidden');
    this.footer?.classList.add('hidden');
  },

  resetControlsTimer() {
    clearTimeout(this.hideControlsTimeout);
    this.hideControlsTimeout = setTimeout(() => {
      this.hideControls();
    }, 4500);
  },

  toggleMode() {
    this.mode = this.mode === 'webtoon' ? 'single' : 'webtoon';
    State.updateSettings({ readerMode: this.mode });
    this.updateControlsUI();
    this.render();
  },

  toggleQuality() {
    this.quality = this.quality === 'high' ? 'saver' : 'high';
    State.updateSettings({ imageQuality: this.quality });
    this.updateControlsUI();
    this.render();
  },

  toggleDirection() {
    this.direction = this.direction === 'ltr' ? 'rtl' : 'ltr';
    State.updateSettings({ readingDirection: this.direction });
    this.updateControlsUI();
    this.render();
  },

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('Fullscreen failed:', err);
      });
    } else {
      document.exitFullscreen().catch(err => {
        console.warn('Exit fullscreen failed:', err);
      });
    }
  },

  toggleDrawer() {
    if (this.isDrawerOpen()) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  },

  openDrawer() {
    this.chapterDrawer?.classList.add('open');
    this.showControls();
    clearTimeout(this.hideControlsTimeout);
  },

  closeDrawer() {
    this.chapterDrawer?.classList.remove('open');
    this.resetControlsTimer();
  },

  populateDrawer() {
    const listEl = document.getElementById('reader-drawer-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    this.allChapters.forEach(c => {
      const isCurrent = c.id === this.activeChapter.id;
      const item = document.createElement('div');
      item.className = `chapter-item-card ${isCurrent ? 'current' : ''}`;
      item.innerHTML = `
        <div class="chap-card-left">
          <span class="chap-num">Chapter ${c.attributes?.chapter || '1'}</span>
          <span class="chap-title">${c.attributes?.title || 'No Title'}</span>
        </div>
        <div class="chap-card-right">
          ${isCurrent ? '<span class="badge-readable-tag">Reading</span>' : ''}
        </div>
      `;

      item.onclick = () => {
        this.closeDrawer();
        if (!isCurrent) {
          this.openChapter({ manga: this.activeManga, chapter: c, allChapters: this.allChapters });
        }
      };

      listEl.appendChild(item);
    });
  },

  updateControlsUI() {
    const modeBtn = document.getElementById('reader-btn-mode');
    const qualityBtn = document.getElementById('reader-btn-quality');
    const dirBtn = document.getElementById('reader-btn-direction');

    if (modeBtn) {
      modeBtn.textContent = this.mode === 'webtoon' ? '📜 Webtoon' : '📄 Single Page';
    }
    if (qualityBtn) {
      qualityBtn.textContent = this.quality === 'high' ? 'HD' : 'Data Saver';
    }
    if (dirBtn) {
      dirBtn.textContent = this.direction === 'ltr' ? 'LTR' : 'RTL';
    }
  },

  close() {
    this.container?.classList.remove('active');
    document.body.style.overflow = '';
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    clearTimeout(this.hideControlsTimeout);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }
};
