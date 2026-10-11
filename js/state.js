/**
 * MangaVerse - State & Storage Manager
 * Handles local persistence for user preferences, bookmarks, history, and cached states.
 */

const STORAGE_KEYS = {
  SETTINGS: 'mangaverse_settings_v1',
  BOOKMARKS: 'mangaverse_bookmarks_v1',
  HISTORY: 'mangaverse_history_v1',
  SEARCHES: 'mangaverse_searches_v1'
};

const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark', 'amoled', 'light'
  readerMode: 'webtoon', // 'webtoon', 'single', 'double'
  readingDirection: 'ltr', // 'rtl', 'ltr'
  imageQuality: 'high', // 'high', 'saver'
  preferredLanguage: 'en', // 'en', 'es', 'pt-br', 'fr', 'all'
  autoNextChapter: true
};

class StateManager {
  constructor() {
    this.settings = this.load(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    this.bookmarks = this.load(STORAGE_KEYS.BOOKMARKS, []);
    this.history = this.load(STORAGE_KEYS.HISTORY, []);
    this.recentSearches = this.load(STORAGE_KEYS.SEARCHES, []);
    this.listeners = new Map();
  }

  load(key, fallback) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch (e) {
      console.warn(`Failed to read from localStorage (${key}):`, e);
      return fallback;
    }
  }

  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`Failed to write to localStorage (${key}):`, e);
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (err) { console.error(err); }
      });
    }
  }

  // --- Settings ---
  getSettings() {
    return { ...this.settings };
  }

  updateSettings(updates) {
    this.settings = { ...this.settings, ...updates };
    this.save(STORAGE_KEYS.SETTINGS, this.settings);
    this.emit('settingsChange', this.settings);
  }

  // --- Bookmarks ---
  isBookmarked(mangaId) {
    return this.bookmarks.some(b => b.id === mangaId);
  }

  toggleBookmark(mangaSummary) {
    const index = this.bookmarks.findIndex(b => b.id === mangaSummary.id);
    let isNowBookmarked = false;

    if (index >= 0) {
      this.bookmarks.splice(index, 1);
    } else {
      this.bookmarks.unshift({
        id: mangaSummary.id,
        title: mangaSummary.title,
        cover: mangaSummary.cover,
        rating: mangaSummary.rating,
        status: mangaSummary.status,
        tag: mangaSummary.tag,
        addedAt: Date.now()
      });
      isNowBookmarked = true;
    }

    this.save(STORAGE_KEYS.BOOKMARKS, this.bookmarks);
    this.emit('bookmarksChange', { mangaId: mangaSummary.id, isBookmarked: isNowBookmarked, bookmarks: this.bookmarks });
    return isNowBookmarked;
  }

  getBookmarks() {
    return [...this.bookmarks];
  }

  removeBookmark(mangaId) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== mangaId);
    this.save(STORAGE_KEYS.BOOKMARKS, this.bookmarks);
    this.emit('bookmarksChange', { mangaId, isBookmarked: false, bookmarks: this.bookmarks });
  }

  // --- Reading History ---
  saveHistory({ mangaId, mangaTitle, cover, chapterId, chapterNum, chapterTitle, page = 1, totalPages = 1 }) {
    if (!mangaId || !chapterId) return;

    const existingIndex = this.history.findIndex(h => h.mangaId === mangaId);
    const historyItem = {
      mangaId,
      mangaTitle,
      cover,
      chapterId,
      chapterNum: chapterNum ? String(chapterNum) : '?',
      chapterTitle: chapterTitle || '',
      page: Number(page),
      totalPages: Number(totalPages) || 1,
      percent: Math.min(100, Math.round((Number(page) / (Number(totalPages) || 1)) * 100)),
      updatedAt: Date.now()
    };

    if (existingIndex >= 0) {
      this.history.splice(existingIndex, 1);
    }

    // Keep history sorted with newest first, max 60 items
    this.history.unshift(historyItem);
    if (this.history.length > 60) {
      this.history.pop();
    }

    this.save(STORAGE_KEYS.HISTORY, this.history);
    this.emit('historyChange', this.history);
  }

  getHistoryForManga(mangaId) {
    return this.history.find(h => h.mangaId === mangaId) || null;
  }

  getAllHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
    this.save(STORAGE_KEYS.HISTORY, this.history);
    this.emit('historyChange', this.history);
  }

  // --- Recent Searches ---
  addRecentSearch(query) {
    const trimmed = query.trim();
    if (!trimmed) return;

    this.recentSearches = [trimmed, ...this.recentSearches.filter(s => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
    this.save(STORAGE_KEYS.SEARCHES, this.recentSearches);
    this.emit('searchesChange', this.recentSearches);
  }

  getRecentSearches() {
    return [...this.recentSearches];
  }

  clearRecentSearches() {
    this.recentSearches = [];
    this.save(STORAGE_KEYS.SEARCHES, this.recentSearches);
    this.emit('searchesChange', this.recentSearches);
  }
}

export const State = new StateManager();
