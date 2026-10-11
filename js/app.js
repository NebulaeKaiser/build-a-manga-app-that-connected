/**
 * MangaVerse - Main Application Controller
 * Handles views, browsing, search debounce, carousels, manga detail modals, and settings.
 */

import { MangaAPI } from './api.js';
import { State } from './state.js';
import { Reader } from './reader.js';

// Top genre tags mapping
const POPULAR_GENRES = [
  { name: 'All', id: '' },
  { name: 'Action', id: '391b0423-d847-456f-aff0-8b0cfc03066b' },
  { name: 'Fantasy', id: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc' },
  { name: 'Romance', id: '423e2eae-a7a2-4a8b-ac03-a8351462d71d' },
  { name: 'Comedy', id: '4d32cc48-9f00-4cca-9b5a-a839f0764984' },
  { name: 'Isekai', id: 'ace04997-f6bd-436e-b261-779182193d3d' },
  { name: 'Sci-Fi', id: '256c8bd9-4904-4360-bf4f-508a76d67183' },
  { name: 'Slice of Life', id: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9' },
  { name: 'Mystery', id: 'ee968100-4191-4968-93d3-f82d72be7e46' },
  { name: 'Horror', id: 'cdad7e68-1419-41dd-bdce-27753074a640' },
  { name: 'Thriller', id: '07251805-a27e-4d59-b488-f0bfbec15168' },
  { name: 'Drama', id: 'b9af3a63-f058-46de-a9a0-e0c13906197a' },
  { name: 'Psychological', id: '3b60b75c-a2d7-4860-ab56-05f391bb889c' },
  { name: 'Martial Arts', id: '799c202e-7daa-44eb-9cf7-8a3c0441531e' },
  { name: 'Reincarnation', id: '0bc90acb-ccc1-44ca-a34a-b9f3a73259d0' }
];

export const App = {
  currentView: 'explore',
  activeMangaDetail: null,
  activeDetailChapters: [],
  detailSelectedLanguage: 'en',
  detailChapterSort: 'asc',
  detailFilterReadableOnly: true,
  searchDebounceTimer: null,
  heroSlides: [],
  currentHeroIndex: 0,
  heroAutoPlayTimer: null,

  // Browse state
  browseOffset: 0,
  browseLimit: 24,
  browseTotal: 0,
  browseActiveTag: '',
  browseSelectedStatus: '',
  browseSelectedDemographic: '',
  browseSelectedSort: 'followedCount',
  browseSelectedOrder: 'desc',
  browseIsLoading: false,

  init() {
    this.applyTheme(State.getSettings().theme);
    Reader.init();
    this.bindDOM();
    this.renderGenrePills();
    this.renderBrowseFilterChips();
    this.loadExploreView();
    this.updateContinueReadingShelf();
    this.updateLibraryView();

    // Listen to state changes
    State.on('bookmarksChange', () => {
      this.updateLibraryView();
      this.syncDetailBookmarkButton();
    });

    State.on('historyChange', () => {
      this.updateContinueReadingShelf();
      this.updateLibraryView();
    });

    State.on('settingsChange', (settings) => {
      this.applyTheme(settings.theme);
    });
  },

  applyTheme(theme) {
    if (theme === 'amoled') {
      document.documentElement.setAttribute('data-theme', 'amoled');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  },

  bindDOM() {
    // Navigation Links
    document.querySelectorAll('[data-view-target]').forEach(el => {
      el.addEventListener('click', () => {
        const target = el.dataset.viewTarget;
        this.switchView(target);
      });
    });

    // Header Search Input
    const headerSearch = document.getElementById('header-search-input');
    const searchClear = document.getElementById('search-clear-btn');
    if (headerSearch) {
      headerSearch.addEventListener('input', (e) => {
        const val = e.target.value;
        if (searchClear) searchClear.style.display = val ? 'flex' : 'none';

        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.onSearchSubmit(val);
        }, 400);
      });

      headerSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(this.searchDebounceTimer);
          this.onSearchSubmit(e.target.value);
        }
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (headerSearch) {
          headerSearch.value = '';
          searchClear.style.display = 'none';
          this.onSearchSubmit('');
        }
      });
    }

    // Keyboard shortcut '/' to search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== headerSearch && !Reader.isOpen()) {
        e.preventDefault();
        headerSearch?.focus();
      }
    });

    // Random Manga Button
    document.getElementById('btn-random-manga')?.addEventListener('click', () => {
      this.openRandomManga();
    });

    // Settings Modal
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.openSettingsModal();
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.closeSettingsModal();
    });
    document.getElementById('modal-settings')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-settings') this.closeSettingsModal();
    });

    // Detail Modal Close
    document.getElementById('detail-modal-close')?.addEventListener('click', () => {
      this.closeMangaDetail();
    });
    document.getElementById('modal-manga-detail')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-manga-detail') this.closeMangaDetail();
    });

    // Detail Chapter Search & Filter controls
    document.getElementById('detail-chap-search')?.addEventListener('input', () => {
      this.renderDetailChaptersList();
    });

    document.getElementById('detail-chap-sort-btn')?.addEventListener('click', () => {
      this.detailChapterSort = this.detailChapterSort === 'asc' ? 'desc' : 'asc';
      const btn = document.getElementById('detail-chap-sort-btn');
      if (btn) btn.textContent = this.detailChapterSort === 'asc' ? 'Order: 1 ➔ Last' : 'Order: Last ➔ 1';
      this.renderDetailChaptersList();
    });

    document.getElementById('detail-readable-toggle')?.addEventListener('change', (e) => {
      this.detailFilterReadableOnly = e.target.checked;
      this.renderDetailChaptersList();
    });

    // Browse Filters Controls
    document.getElementById('browse-status-select')?.addEventListener('change', (e) => {
      this.browseSelectedStatus = e.target.value;
      this.performBrowseSearch(true);
    });

    document.getElementById('browse-sort-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'rating') {
        this.browseSelectedSort = 'rating';
        this.browseSelectedOrder = 'desc';
      } else if (val === 'latest') {
        this.browseSelectedSort = 'latestUploadedChapter';
        this.browseSelectedOrder = 'desc';
      } else if (val === 'title') {
        this.browseSelectedSort = 'title';
        this.browseSelectedOrder = 'asc';
      } else {
        this.browseSelectedSort = 'followedCount';
        this.browseSelectedOrder = 'desc';
      }
      this.performBrowseSearch(true);
    });

    document.getElementById('browse-demographic-select')?.addEventListener('change', (e) => {
      this.browseSelectedDemographic = e.target.value;
      this.performBrowseSearch(true);
    });

    document.getElementById('browse-readable-only')?.addEventListener('change', () => {
      this.performBrowseSearch(true);
    });

    document.getElementById('btn-browse-load-more')?.addEventListener('click', () => {
      this.loadMoreBrowseResults();
    });

    // Library Tabs
    document.querySelectorAll('.library-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.library-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const targetSub = tab.dataset.libraryTab;
        document.querySelectorAll('.library-subview').forEach(v => v.style.display = 'none');
        const targetView = document.getElementById(`library-sub-${targetSub}`);
        if (targetView) targetView.style.display = 'block';
      });
    });

    // Settings Controls
    document.getElementById('settings-theme-select')?.addEventListener('change', (e) => {
      State.updateSettings({ theme: e.target.value });
    });

    document.getElementById('settings-reader-mode-select')?.addEventListener('change', (e) => {
      State.updateSettings({ readerMode: e.target.value });
    });

    document.getElementById('settings-reader-direction-select')?.addEventListener('change', (e) => {
      State.updateSettings({ readingDirection: e.target.value });
    });

    document.getElementById('settings-quality-select')?.addEventListener('change', (e) => {
      State.updateSettings({ imageQuality: e.target.value });
    });

    document.getElementById('settings-clear-history-btn')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear your entire reading history?')) {
        State.clearHistory();
        this.showToast('Reading history cleared', 'info');
      }
    });

    // Reader UI buttons
    document.getElementById('reader-back-btn')?.addEventListener('click', () => {
      Reader.close();
      if (this.activeMangaDetail) {
        this.openMangaDetail(this.activeMangaDetail.id);
      }
    });

    document.getElementById('reader-btn-mode')?.addEventListener('click', () => {
      Reader.toggleMode();
    });

    document.getElementById('reader-btn-quality')?.addEventListener('click', () => {
      Reader.toggleQuality();
    });

    document.getElementById('reader-btn-direction')?.addEventListener('click', () => {
      Reader.toggleDirection();
    });

    document.getElementById('reader-btn-drawer')?.addEventListener('click', () => {
      Reader.toggleDrawer();
    });

    document.getElementById('reader-drawer-close')?.addEventListener('click', () => {
      Reader.closeDrawer();
    });

    document.getElementById('reader-btn-fullscreen')?.addEventListener('click', () => {
      Reader.toggleFullscreen();
    });

    document.getElementById('reader-btn-prev')?.addEventListener('click', () => {
      Reader.prevPage();
    });

    document.getElementById('reader-btn-next')?.addEventListener('click', () => {
      Reader.nextPage();
    });
  },

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.viewTarget === viewName);
    });
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.viewTarget === viewName);
    });

    const targetEl = document.getElementById(`view-${viewName}`);
    if (targetEl) targetEl.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (viewName === 'browse' && !this.hasLoadedBrowseInitial) {
      this.hasLoadedBrowseInitial = true;
      this.performBrowseSearch(true);
    }
  },

  onSearchSubmit(query) {
    this.switchView('browse');
    const browseInput = document.getElementById('browse-search-input');
    if (browseInput) browseInput.value = query;
    const headerInput = document.getElementById('header-search-input');
    if (headerInput && headerInput.value !== query) headerInput.value = query;

    if (query) State.addRecentSearch(query);
    this.performBrowseSearch(true);
  },

  renderGenrePills() {
    const container = document.getElementById('genre-pills-bar');
    if (!container) return;

    container.innerHTML = '';
    POPULAR_GENRES.forEach((g, idx) => {
      const pill = document.createElement('div');
      pill.className = `genre-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.name;
      pill.dataset.tagId = g.id;

      pill.addEventListener('click', () => {
        container.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.browseActiveTag = g.id;
        this.switchView('browse');
        this.updateBrowseFilterChipsActive();
        this.performBrowseSearch(true);
      });

      container.appendChild(pill);
    });
  },

  renderBrowseFilterChips() {
    const container = document.getElementById('browse-tags-grid');
    if (!container) return;

    container.innerHTML = '';
    POPULAR_GENRES.slice(1).forEach(g => {
      const chip = document.createElement('div');
      chip.className = 'browse-tag-chip';
      chip.textContent = g.name;
      chip.dataset.tagId = g.id;

      chip.addEventListener('click', () => {
        if (this.browseActiveTag === g.id) {
          this.browseActiveTag = '';
          chip.classList.remove('active');
        } else {
          this.browseActiveTag = g.id;
          container.querySelectorAll('.browse-tag-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        }
        this.performBrowseSearch(true);
      });

      container.appendChild(chip);
    });
  },

  updateBrowseFilterChipsActive() {
    const container = document.getElementById('browse-tags-grid');
    if (!container) return;
    container.querySelectorAll('.browse-tag-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.tagId === this.browseActiveTag);
    });
  },

  async loadExploreView() {
    this.renderSkeletonGrid('trending-manga-grid', 8);
    this.renderSkeletonGrid('top-rated-manga-grid', 8);
    this.renderSkeletonGrid('latest-updates-grid', 8);

    try {
      // 1. Featured manga for hero slider
      const featured = await MangaAPI.getFeaturedManga();
      if (featured.length > 0) {
        this.heroSlides = featured;
        this.renderHeroSlider(featured);
      }

      // 2. Trending manga
      const trending = await MangaAPI.getTrendingManga(8);
      this.renderMangaGrid('trending-manga-grid', trending.data || []);

      // 3. Top Rated manga
      const topRated = await MangaAPI.getTopRatedManga(8);
      this.renderMangaGrid('top-rated-manga-grid', topRated.data || []);

      // 4. Latest Updates
      const latest = await MangaAPI.getLatestUpdates(8);
      this.renderMangaGrid('latest-updates-grid', latest.data || []);
    } catch (err) {
      console.error('Failed to load explore feed:', err);
      this.showToast('Unable to connect to MangaDex server. Retrying...', 'error');
    }
  },

  renderHeroSlider(slides) {
    const inner = document.getElementById('hero-slider-inner');
    const nav = document.getElementById('hero-slider-nav');
    if (!inner) return;

    inner.innerHTML = '';
    if (nav) nav.innerHTML = '';

    slides.forEach((manga, idx) => {
      const slide = document.createElement('div');
      slide.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
      slide.id = `hero-slide-${idx}`;

      const title = MangaAPI.resolveTitle(manga);
      const coverUrl = MangaAPI.resolveCoverUrl(manga, '512');
      const desc = manga.attributes?.description?.en || 'No description available.';
      const status = manga.attributes?.status || 'ongoing';
      const year = manga.attributes?.year || '';

      slide.innerHTML = `
        <div class="hero-backdrop" style="background-image: url('${coverUrl}');"></div>
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <div class="hero-cover-wrap">
            <img class="hero-cover" src="${coverUrl}" alt="${title}" loading="lazy" />
          </div>
          <div class="hero-details">
            <div class="hero-badge-row">
              <span class="hero-tag spotlight">Featured #1</span>
              <span class="hero-tag">${status.toUpperCase()}</span>
              ${year ? `<span class="hero-tag">${year}</span>` : ''}
              <span class="hero-tag rating">
                <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                Top Followed
              </span>
            </div>
            <h1 class="hero-title">${title}</h1>
            <p class="hero-desc">${desc}</p>
            <div class="hero-actions">
              <button class="btn btn-primary" id="hero-read-btn-${idx}">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Read Now
              </button>
              <button class="btn btn-secondary" id="hero-info-btn-${idx}">
                More Info
              </button>
            </div>
          </div>
        </div>
      `;

      slide.querySelector(`#hero-read-btn-${idx}`)?.addEventListener('click', () => {
        this.openMangaDetail(manga.id, true);
      });

      slide.querySelector(`#hero-info-btn-${idx}`)?.addEventListener('click', () => {
        this.openMangaDetail(manga.id);
      });

      inner.appendChild(slide);

      // Dot navigation
      if (nav) {
        const dot = document.createElement('div');
        dot.className = `slider-dot ${idx === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => this.goToHeroSlide(idx));
        nav.appendChild(dot);
      }
    });

    this.startHeroAutoPlay();
  },

  goToHeroSlide(index) {
    if (this.heroSlides.length === 0) return;
    this.currentHeroIndex = index;

    document.querySelectorAll('.hero-slide').forEach((s, idx) => {
      s.classList.toggle('active', idx === index);
    });
    document.querySelectorAll('.slider-dot').forEach((d, idx) => {
      d.classList.toggle('active', idx === index);
    });

    this.startHeroAutoPlay();
  },

  startHeroAutoPlay() {
    clearInterval(this.heroAutoPlayTimer);
    this.heroAutoPlayTimer = setInterval(() => {
      if (this.heroSlides.length > 1) {
        const next = (this.currentHeroIndex + 1) % this.heroSlides.length;
        this.goToHeroSlide(next);
      }
    }, 6000);
  },

  renderMangaGrid(containerId, mangaList) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (!mangaList || mangaList.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: var(--text-muted);">
          No manga found for this section.
        </div>
      `;
      return;
    }

    mangaList.forEach(manga => {
      const card = this.createMangaCard(manga);
      container.appendChild(card);
    });
  },

  createMangaCard(manga) {
    const card = document.createElement('div');
    card.className = 'manga-card';

    const title = MangaAPI.resolveTitle(manga);
    const coverUrl = MangaAPI.resolveCoverUrl(manga, '256');
    const status = manga.attributes?.status || 'ongoing';
    const isBookmarked = State.isBookmarked(manga.id);
    const tags = MangaAPI.resolveTags(manga);
    const firstTag = tags.length > 0 ? tags[0].name : 'Manga';

    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img class="card-thumb" src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&q=80&auto=format&fit=crop';" />
        <div class="card-overlay-gradient"></div>
        <div class="card-badge-top">
          <span class="badge-status ${status}">${status}</span>
        </div>
        <button class="card-bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" title="${isBookmarked ? 'Remove Bookmark' : 'Add to Bookmarks'}">
          <svg width="16" height="16" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      </div>
      <div class="card-info">
        <h3 class="card-title" title="${title}">${title}</h3>
        <div class="card-meta-row">
          <span class="card-tag">${firstTag}</span>
          <span style="display: flex; align-items: center; gap: 3px; color: #facc15; font-weight: 600;">
            ★
          </span>
        </div>
      </div>
    `;

    // Bookmark button click
    const bookmarkBtn = card.querySelector('.card-bookmark-btn');
    bookmarkBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const newState = State.toggleBookmark({
        id: manga.id,
        title,
        cover: coverUrl,
        status,
        tag: firstTag
      });
      bookmarkBtn.classList.toggle('bookmarked', newState);
      bookmarkBtn.querySelector('svg').setAttribute('fill', newState ? 'currentColor' : 'none');
      this.showToast(newState ? `Added "${title}" to library` : `Removed "${title}" from library`, 'info');
    });

    // Card click opens detail modal
    card.addEventListener('click', () => {
      this.openMangaDetail(manga.id);
    });

    return card;
  },

  renderSkeletonGrid(containerId, count = 8) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skel = document.createElement('div');
      skel.className = 'manga-card';
      skel.innerHTML = `
        <div class="card-thumb-wrap skeleton" style="aspect-ratio: 7/10;"></div>
        <div class="card-info" style="gap: 8px;">
          <div class="skeleton" style="height: 16px; width: 85%;"></div>
          <div class="skeleton" style="height: 12px; width: 45%;"></div>
        </div>
      `;
      container.appendChild(skel);
    }
  },

  updateContinueReadingShelf() {
    const shelf = document.getElementById('continue-reading-shelf');
    const grid = document.getElementById('continue-reading-grid');
    if (!shelf || !grid) return;

    const history = State.getAllHistory();
    if (history.length === 0) {
      shelf.style.display = 'none';
      return;
    }

    shelf.style.display = 'block';
    grid.innerHTML = '';

    history.slice(0, 4).forEach(item => {
      const card = document.createElement('div');
      card.className = 'continue-card';
      card.innerHTML = `
        <img class="continue-thumb" src="${item.cover}" alt="${item.mangaTitle}" loading="lazy" />
        <div class="continue-details">
          <div>
            <h4 class="continue-title" title="${item.mangaTitle}">${item.mangaTitle}</h4>
            <span class="continue-chapter">Chapter ${item.chapterNum}</span>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-subtle);">
              <span>Page ${item.page} of ${item.totalPages}</span>
              <span>${item.percent}%</span>
            </div>
            <div class="continue-progress-bar">
              <div class="continue-progress-fill" style="width: ${item.percent}%;"></div>
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', async () => {
        try {
          this.showToast(`Resuming "${item.mangaTitle}"...`, 'info');
          const manga = await MangaAPI.getMangaDetails(item.mangaId);
          const chapRes = await MangaAPI.getMangaChapters(item.mangaId, { limit: 100 });
          const targetChap = chapRes.data?.find(c => c.id === item.chapterId) || { id: item.chapterId, attributes: { chapter: item.chapterNum } };
          Reader.openChapter({
            manga,
            chapter: targetChap,
            allChapters: chapRes.data || [targetChap]
          });
        } catch (err) {
          console.error(err);
          this.openMangaDetail(item.mangaId);
        }
      });

      grid.appendChild(card);
    });
  },

  // --- Browse & Search Execution ---
  async performBrowseSearch(reset = false) {
    if (this.browseIsLoading) return;
    this.browseIsLoading = true;

    if (reset) {
      this.browseOffset = 0;
      this.renderSkeletonGrid('browse-results-grid', 12);
      const loadMoreBtn = document.getElementById('btn-browse-load-more');
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    }

    const searchInput = document.getElementById('browse-search-input');
    const headerInput = document.getElementById('header-search-input');
    const query = (searchInput?.value || headerInput?.value || '').trim();

    const tags = this.browseActiveTag ? [this.browseActiveTag] : [];
    const status = this.browseSelectedStatus || '';
    const demographic = this.browseSelectedDemographic ? [this.browseSelectedDemographic] : [];
    const sort = this.browseSelectedSort;
    const sortOrder = this.browseSelectedOrder;

    try {
      const res = await MangaAPI.searchManga({
        query,
        tags,
        status,
        demographic,
        sort,
        sortOrder,
        limit: this.browseLimit,
        offset: this.browseOffset
      });

      const mangaList = res.data || [];
      this.browseTotal = res.total || 0;

      const grid = document.getElementById('browse-results-grid');
      const countEl = document.getElementById('browse-results-count');
      if (countEl) {
        countEl.textContent = `Found ${this.browseTotal.toLocaleString()} manga`;
      }

      if (reset) {
        grid.innerHTML = '';
      }

      if (mangaList.length === 0 && reset) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 4rem 1.5rem; text-align: center;">
            <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin: 0 auto 1rem; color: var(--text-subtle);">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem;">No manga found</h3>
            <p style="color: var(--text-muted); font-size: 0.92rem;">Try different keywords or clearing tag filters.</p>
          </div>
        `;
      } else {
        mangaList.forEach(manga => {
          grid.appendChild(this.createMangaCard(manga));
        });
      }

      // Show / hide Load More button
      const loadMoreBtn = document.getElementById('btn-browse-load-more');
      if (loadMoreBtn) {
        const hasMore = this.browseOffset + mangaList.length < this.browseTotal;
        loadMoreBtn.style.display = hasMore ? 'inline-flex' : 'none';
      }

      this.browseOffset += mangaList.length;
    } catch (err) {
      console.error('Browse search failed:', err);
      this.showToast('Failed to load manga results', 'error');
    } finally {
      this.browseIsLoading = false;
    }
  },

  loadMoreBrowseResults() {
    this.performBrowseSearch(false);
  },

  // --- Manga Detail View & Modal ---
  async openMangaDetail(mangaId, startReadingImmediate = false) {
    const modal = document.getElementById('modal-manga-detail');
    if (!modal) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Show loading skeleton in modal
    const scrollWrap = document.getElementById('detail-scroll-wrap');
    if (scrollWrap) {
      scrollWrap.innerHTML = `
        <div style="padding: 4rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;">
          <div class="spinner" style="width: 40px; height: 40px;"></div>
          <span style="color: var(--text-muted); font-size: 0.95rem;">Fetching manga information & chapters...</span>
        </div>
      `;
    }

    try {
      const manga = await MangaAPI.getMangaDetails(mangaId);
      this.activeMangaDetail = manga;

      // Render details
      this.renderMangaDetailDOM(manga);

      // Fetch chapters
      await this.loadMangaChapters(mangaId);

      // If requested to start reading immediately
      if (startReadingImmediate) {
        const readableChap = this.activeDetailChapters.find(c => c.attributes?.pages > 0);
        if (readableChap) {
          this.closeMangaDetail();
          Reader.openChapter({
            manga,
            chapter: readableChap,
            allChapters: this.activeDetailChapters
          });
        }
      }
    } catch (err) {
      console.error('Failed to open manga details:', err);
      if (scrollWrap) {
        scrollWrap.innerHTML = `
          <div style="padding: 4rem; text-align: center;">
            <p style="color: #f87171; margin-bottom: 1rem;">Failed to load manga details.</p>
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('modal-manga-detail').classList.remove('active'); document.body.style.overflow = '';">Close</button>
          </div>
        `;
      }
    }
  },

  closeMangaDetail() {
    const modal = document.getElementById('modal-manga-detail');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
    this.activeMangaDetail = null;
  },

  renderMangaDetailDOM(manga) {
    const scrollWrap = document.getElementById('detail-scroll-wrap');
    if (!scrollWrap) return;

    const title = MangaAPI.resolveTitle(manga);
    const altTitle = MangaAPI.resolveAltTitle(manga);
    const coverUrl = MangaAPI.resolveCoverUrl(manga, '512');
    const { author, artist } = MangaAPI.resolveCreators(manga);
    const tags = MangaAPI.resolveTags(manga);
    const status = manga.attributes?.status || 'ongoing';
    const year = manga.attributes?.year || 'Unknown';
    const demographic = manga.attributes?.publicationDemographic || '';
    const desc = manga.attributes?.description?.en || 'No description available for this manga.';
    const isBookmarked = State.isBookmarked(manga.id);

    // Rating and follows stats
    const ratingScore = manga.stats?.rating?.bayesian ? manga.stats.rating.bayesian.toFixed(1) : '8.5';
    const followsCount = manga.stats?.follows ? manga.stats.follows.toLocaleString() : '10K+';

    // Saved history check
    const history = State.getHistoryForManga(manga.id);

    scrollWrap.innerHTML = `
      <div class="detail-hero-banner">
        <div class="detail-backdrop" style="background-image: url('${coverUrl}');"></div>
        <div class="detail-backdrop-overlay"></div>
        <div class="detail-cover-box">
          <img class="detail-cover" src="${coverUrl}" alt="${title}" />
        </div>
        <div class="detail-head-info">
          <h2 class="detail-title">${title}</h2>
          ${altTitle ? `<p class="detail-alt-title">${altTitle}</p>` : ''}
          <div class="detail-stats-pills">
            <span class="stat-pill" style="color: #facc15; font-weight: 700;">★ ${ratingScore} / 10</span>
            <span class="stat-pill">👥 ${followsCount} follows</span>
            <span class="stat-pill" style="text-transform: capitalize;">${status}</span>
            ${demographic ? `<span class="stat-pill" style="text-transform: capitalize;">${demographic}</span>` : ''}
            <span class="stat-pill">${year}</span>
          </div>
          <div class="detail-action-buttons">
            <button class="btn btn-primary" id="detail-btn-start-read">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              ${history ? `Resume Ch. ${history.chapterNum}` : 'Start Reading'}
            </button>
            <button class="btn btn-secondary" id="detail-btn-bookmark">
              <svg width="16" height="16" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
              ${isBookmarked ? 'Bookmarked' : 'Add to Library'}
            </button>
            <button class="btn btn-secondary" id="detail-btn-share" title="Copy Link">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="detail-body">
        <div class="detail-tags-row">
          ${tags.map(t => `<span class="detail-genre-chip" data-tag-id="${t.id}">${t.name}</span>`).join('')}
        </div>

        <div class="detail-synopsis-box">
          <h4 class="synopsis-title">Synopsis</h4>
          <p class="synopsis-text">${desc}</p>
          <div style="margin-top: 1rem; font-size: 0.82rem; color: var(--text-subtle); display: flex; gap: 1.5rem; flex-wrap: wrap;">
            <span><strong>Author:</strong> ${author}</span>
            <span><strong>Artist:</strong> ${artist}</span>
          </div>
        </div>

        <div class="detail-chapters-section">
          <div class="chapters-header-bar">
            <div>
              <h3 style="font-size: 1.15rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                Chapters
                <span id="detail-chapter-count-badge" class="stat-pill" style="font-size: 0.72rem;">0</span>
              </h3>
            </div>
            <div class="chapters-controls">
              <div class="chapters-lang-pills" id="detail-lang-pills">
                <!-- Dynamically populated based on manga.attributes.availableTranslatedLanguages -->
              </div>
              <input type="text" class="chapter-search-box" id="detail-chap-search-input" placeholder="Search ch..." />
              <button class="btn btn-secondary btn-sm" id="detail-chap-sort-toggle">
                1 ➔ Last
              </button>
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: var(--text-muted); cursor: pointer;">
              <input type="checkbox" id="detail-readable-only-checkbox" checked style="accent-color: var(--accent-primary);" />
              Show readable in app (${tags.some(t => t.name === 'Manhwa' || t.name === 'Webtoon') ? 'Webtoon' : 'Manga'})
            </label>
          </div>

          <div class="chapters-list" id="detail-chapters-container">
            <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">
              Loading chapters...
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind detail buttons
    document.getElementById('detail-btn-start-read')?.addEventListener('click', () => {
      this.startOrResumeReading();
    });

    document.getElementById('detail-btn-bookmark')?.addEventListener('click', () => {
      const newState = State.toggleBookmark({
        id: manga.id,
        title,
        cover: coverUrl,
        status,
        tag: tags[0]?.name || 'Manga'
      });
      this.syncDetailBookmarkButton();
      this.showToast(newState ? 'Added to your library' : 'Removed from library', 'info');
    });

    document.getElementById('detail-btn-share')?.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href);
      this.showToast('App link copied to clipboard!', 'info');
    });

    // Populate and bind dynamic language pills
    const langPillsContainer = document.getElementById('detail-lang-pills');
    if (langPillsContainer) {
      const rawLangs = manga.attributes?.availableTranslatedLanguages || [];
      const hasEn = rawLangs.includes('en');
      let langList = [...rawLangs];
      if (langList.length === 0) langList = ['en', 'es', 'pt-br', 'fr'];
      
      // Select best initial language
      this.detailSelectedLanguage = hasEn ? 'en' : (langList[0] || 'all');
      
      langPillsContainer.innerHTML = '';
      langList.slice(0, 7).forEach(langCode => {
        const pill = document.createElement('span');
        pill.className = `lang-pill ${this.detailSelectedLanguage === langCode ? 'active' : ''}`;
        pill.dataset.lang = langCode;
        pill.textContent = langCode.toUpperCase();
        pill.addEventListener('click', () => {
          langPillsContainer.querySelectorAll('.lang-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          this.detailSelectedLanguage = langCode;
          this.loadMangaChapters(manga.id);
        });
        langPillsContainer.appendChild(pill);
      });

      // Add 'All' pill
      const allPill = document.createElement('span');
      allPill.className = `lang-pill ${this.detailSelectedLanguage === 'all' ? 'active' : ''}`;
      allPill.dataset.lang = 'all';
      allPill.textContent = 'ALL';
      allPill.addEventListener('click', () => {
        langPillsContainer.querySelectorAll('.lang-pill').forEach(p => p.classList.remove('active'));
        allPill.classList.add('active');
        this.detailSelectedLanguage = 'all';
        this.loadMangaChapters(manga.id);
      });
      langPillsContainer.appendChild(allPill);
    }

    // Chapter search input
    document.getElementById('detail-chap-search-input')?.addEventListener('input', (e) => {
      this.renderDetailChaptersList(e.target.value);
    });

    // Chapter sort toggle
    document.getElementById('detail-chap-sort-toggle')?.addEventListener('click', (e) => {
      this.detailChapterSort = this.detailChapterSort === 'asc' ? 'desc' : 'asc';
      e.target.textContent = this.detailChapterSort === 'asc' ? '1 ➔ Last' : 'Last ➔ 1';
      this.renderDetailChaptersList();
    });

    // Readable only toggle
    document.getElementById('detail-readable-only-checkbox')?.addEventListener('change', (e) => {
      this.detailFilterReadableOnly = e.target.checked;
      this.renderDetailChaptersList();
    });

    // Tag clicks in details
    scrollWrap.querySelectorAll('.detail-genre-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tagId = chip.dataset.tagId;
        this.closeMangaDetail();
        this.browseActiveTag = tagId;
        this.switchView('browse');
        this.updateBrowseFilterChipsActive();
        this.performBrowseSearch(true);
      });
    });
  },

  syncDetailBookmarkButton() {
    const btn = document.getElementById('detail-btn-bookmark');
    if (!btn || !this.activeMangaDetail) return;
    const isBookmarked = State.isBookmarked(this.activeMangaDetail.id);
    btn.innerHTML = `
      <svg width="16" height="16" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
      </svg>
      ${isBookmarked ? 'Bookmarked' : 'Add to Library'}
    `;
  },

  async loadMangaChapters(mangaId) {
    const listEl = document.getElementById('detail-chapters-container');
    if (!listEl) return;

    listEl.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        Fetching chapters for language (${this.detailSelectedLanguage.toUpperCase()})...
      </div>
    `;

    try {
      const res = await MangaAPI.getMangaChapters(mangaId, {
        language: this.detailSelectedLanguage,
        limit: 100,
        order: 'asc'
      });

      this.activeDetailChapters = res.data || [];
      const countBadge = document.getElementById('detail-chapter-count-badge');
      if (countBadge) {
        countBadge.textContent = this.activeDetailChapters.length;
      }

      this.renderDetailChaptersList();
    } catch (err) {
      console.error('Failed to load chapters:', err);
      listEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">
          No chapters found or network error. Try switching language to "All".
        </div>
      `;
    }
  },

  renderDetailChaptersList(filterQuery = '') {
    const container = document.getElementById('detail-chapters-container');
    if (!container) return;

    let chapters = [...this.activeDetailChapters];

    // Filter readable in app if toggled
    if (this.detailFilterReadableOnly) {
      chapters = chapters.filter(c => c.attributes?.pages > 0);
    }

    // Filter by query
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      chapters = chapters.filter(c => {
        const num = String(c.attributes?.chapter || '');
        const title = String(c.attributes?.title || '').toLowerCase();
        return num.includes(q) || title.includes(q);
      });
    }

    // Sort order
    if (this.detailChapterSort === 'desc') {
      chapters.reverse();
    }

    container.innerHTML = '';
    if (chapters.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">
          No chapters match current filter.
        </div>
      `;
      return;
    }

    const currentHistory = State.getHistoryForManga(this.activeMangaDetail?.id);

    chapters.forEach(c => {
      const chapNum = c.attributes?.chapter ? `Chapter ${c.attributes.chapter}` : 'Chapter';
      const chapTitle = c.attributes?.title || '';
      const pages = c.attributes?.pages || 0;
      const isReadable = pages > 0;
      const externalUrl = c.attributes?.externalUrl;
      const isRead = currentHistory && String(currentHistory.chapterNum) === String(c.attributes?.chapter);

      // Scanlation group
      const groupRel = c.relationships?.find(r => r.type === 'scanlation_group');
      const groupName = groupRel?.attributes?.name || 'MangaDex';

      const card = document.createElement('div');
      card.className = `chapter-item-card ${isRead ? 'is-read' : ''}`;
      card.innerHTML = `
        <div class="chap-card-left">
          <span class="chap-num">${chapNum}</span>
          ${chapTitle ? `<span class="chap-title">${chapTitle}</span>` : ''}
          <div class="chap-group-meta">
            <span>${groupName}</span>
            <span>•</span>
            <span>${pages > 0 ? `${pages} pages` : 'External'}</span>
          </div>
        </div>
        <div class="chap-card-right">
          ${isReadable ? `
            <span class="badge-readable-tag">Read in App</span>
          ` : `
            <span class="badge-external-tag">Official ↗</span>
          `}
        </div>
      `;

      card.addEventListener('click', () => {
        if (isReadable) {
          this.closeMangaDetail();
          Reader.openChapter({
            manga: this.activeMangaDetail,
            chapter: c,
            allChapters: this.activeDetailChapters.filter(ch => ch.attributes?.pages > 0)
          });
        } else if (externalUrl) {
          window.open(externalUrl, '_blank', 'noopener,noreferrer');
        } else {
          this.showToast('This chapter does not have readable pages hosted on server.', 'info');
        }
      });

      container.appendChild(card);
    });
  },

  startOrResumeReading() {
    if (!this.activeMangaDetail) return;
    const history = State.getHistoryForManga(this.activeMangaDetail.id);

    let targetChap = null;
    const readableChapters = this.activeDetailChapters.filter(c => c.attributes?.pages > 0);

    if (history) {
      targetChap = readableChapters.find(c => c.id === history.chapterId);
    }

    if (!targetChap && readableChapters.length > 0) {
      targetChap = readableChapters[0];
    }

    if (targetChap) {
      this.closeMangaDetail();
      Reader.openChapter({
        manga: this.activeMangaDetail,
        chapter: targetChap,
        allChapters: readableChapters
      });
    } else {
      this.showToast('No readable chapters available for this manga in selected language.', 'info');
    }
  },

  async openRandomManga() {
    try {
      this.showToast('Finding a random manga gem...', 'info');
      const randomManga = await MangaAPI.getRandomManga();
      if (randomManga && randomManga.id) {
        this.openMangaDetail(randomManga.id);
      }
    } catch (err) {
      console.error(err);
      this.showToast('Could not fetch random manga. Please try again.', 'error');
    }
  },

  // --- Library View ---
  updateLibraryView() {
    this.renderBookmarksList();
    this.renderHistoryList();
  },

  renderBookmarksList() {
    const container = document.getElementById('library-bookmarks-grid');
    const emptyEl = document.getElementById('library-bookmarks-empty');
    if (!container) return;

    const bookmarks = State.getBookmarks();
    if (bookmarks.length === 0) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    container.innerHTML = '';

    bookmarks.forEach(b => {
      const card = document.createElement('div');
      card.className = 'manga-card';
      card.innerHTML = `
        <div class="card-thumb-wrap">
          <img class="card-thumb" src="${b.cover}" alt="${b.title}" loading="lazy" />
          <div class="card-overlay-gradient"></div>
          <button class="card-bookmark-btn bookmarked" title="Remove Bookmark">
            <svg width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
        </div>
        <div class="card-info">
          <h3 class="card-title">${b.title}</h3>
          <div class="card-meta-row">
            <span class="card-tag">${b.tag || 'Manga'}</span>
            <span style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 600;">Saved</span>
          </div>
        </div>
      `;

      card.querySelector('.card-bookmark-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        State.removeBookmark(b.id);
        this.showToast(`Removed "${b.title}" from library`, 'info');
      });

      card.addEventListener('click', () => {
        this.openMangaDetail(b.id);
      });

      container.appendChild(card);
    });
  },

  renderHistoryList() {
    const container = document.getElementById('library-history-list');
    const emptyEl = document.getElementById('library-history-empty');
    if (!container) return;

    const history = State.getAllHistory();
    if (history.length === 0) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    container.innerHTML = '';

    history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'continue-card';
      card.innerHTML = `
        <img class="continue-thumb" src="${item.cover}" alt="${item.mangaTitle}" loading="lazy" />
        <div class="continue-details">
          <div>
            <h4 class="continue-title">${item.mangaTitle}</h4>
            <span class="continue-chapter">Chapter ${item.chapterNum} ${item.chapterTitle ? `- ${item.chapterTitle}` : ''}</span>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-subtle);">
              <span>Page ${item.page} of ${item.totalPages}</span>
              <span>${item.percent}%</span>
            </div>
            <div class="continue-progress-bar">
              <div class="continue-progress-fill" style="width: ${item.percent}%;"></div>
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', async () => {
        try {
          this.showToast(`Resuming "${item.mangaTitle}"...`, 'info');
          const manga = await MangaAPI.getMangaDetails(item.mangaId);
          const chapRes = await MangaAPI.getMangaChapters(item.mangaId, { limit: 100 });
          const targetChap = chapRes.data?.find(c => c.id === item.chapterId) || { id: item.chapterId, attributes: { chapter: item.chapterNum } };
          Reader.openChapter({
            manga,
            chapter: targetChap,
            allChapters: chapRes.data || [targetChap]
          });
        } catch (err) {
          console.error(err);
          this.openMangaDetail(item.mangaId);
        }
      });

      container.appendChild(card);
    });
  },

  // --- Settings Modal ---
  openSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Populate current values
    const settings = State.getSettings();
    const themeSelect = document.getElementById('settings-theme-select');
    const modeSelect = document.getElementById('settings-reader-mode-select');
    const dirSelect = document.getElementById('settings-reader-direction-select');
    const qualitySelect = document.getElementById('settings-quality-select');

    if (themeSelect) themeSelect.value = settings.theme;
    if (modeSelect) modeSelect.value = settings.readerMode;
    if (dirSelect) dirSelect.value = settings.readingDirection;
    if (qualitySelect) qualitySelect.value = settings.imageQuality;
  },

  closeSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
  },

  // --- Toasts ---
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span style="display: flex; align-items: center; color: ${type === 'error' ? '#ef4444' : '#4ade80'};">
        ${type === 'error' ? '⚠️' : '✨'}
      </span>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }
};

// Start application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
