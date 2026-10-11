/**
 * MangaVerse - API Service (MangaDex Integration)
 * Provides high-performance, rate-limited, cached access to MangaDex API.
 */

const API_BASE = 'https://api.mangadex.org';
const UPLOADS_BASE = 'https://uploads.mangadex.org';

// In-memory request cache
const apiCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

// Rate Limiting Queue (Max 4 requests per second)
let requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 250; // 4 requests/sec safe threshold

async function executeFetch(url, options = {}, retries = 3) {
  try {
    const res = await fetch(url, options);
    if (res.status === 429) {
      if (retries > 0) {
        console.warn('MangaDex 429 Rate Limit hit. Backing off...');
        await new Promise(r => setTimeout(r, 1200));
        return executeFetch(url, options, retries - 1);
      }
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (retries > 0 && err.message.includes('Failed to fetch')) {
      await new Promise(r => setTimeout(r, 800));
      return executeFetch(url, options, retries - 1);
    }
    throw err;
  }
}

function queuedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ url, options, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const item = requestQueue.shift();
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - timeSinceLast));
    }

    lastRequestTime = Date.now();
    try {
      const data = await executeFetch(item.url, item.options);
      item.resolve(data);
    } catch (err) {
      item.reject(err);
    }
  }

  isProcessingQueue = false;
}

export const MangaAPI = {
  /**
   * Cached fetch with automatic cache key
   */
  async get(endpoint, params = {}, useCache = true) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        value.forEach(v => query.append(`${key}[]`, v));
      } else if (value !== undefined && value !== null && value !== '') {
        query.append(key, value);
      }
    }

    const queryString = query.toString();
    const fullUrl = `${API_BASE}${endpoint}${queryString ? `?${queryString}` : ''}`;

    if (useCache && apiCache.has(fullUrl)) {
      const cached = apiCache.get(fullUrl);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
      }
    }

    try {
      const data = await queuedFetch(fullUrl);
      if (useCache) {
        apiCache.set(fullUrl, { data, timestamp: Date.now() });
      }
      return data;
    } catch (err) {
      console.error('API Error fetching:', fullUrl, err);
      throw err;
    }
  },

  /**
   * Resolve English / best title
   */
  resolveTitle(manga) {
    if (!manga || !manga.attributes) return 'Unknown Title';
    const titles = manga.attributes.title || {};
    if (titles.en) return titles.en;

    // Check altTitles for English
    if (Array.isArray(manga.attributes.altTitles)) {
      for (const alt of manga.attributes.altTitles) {
        if (alt.en) return alt.en;
      }
    }

    // Default to first available title or romaji
    const vals = Object.values(titles);
    return vals.length > 0 ? vals[0] : 'Untitled';
  },

  /**
   * Resolve Alternative title (e.g. Japanese or Romaji)
   */
  resolveAltTitle(manga) {
    if (!manga || !manga.attributes) return '';
    const titles = manga.attributes.title || {};
    const mainTitle = this.resolveTitle(manga);

    for (const [lang, val] of Object.entries(titles)) {
      if (val !== mainTitle) return val;
    }

    if (Array.isArray(manga.attributes.altTitles)) {
      for (const alt of manga.attributes.altTitles) {
        const altVal = Object.values(alt)[0];
        if (altVal && altVal !== mainTitle) return altVal;
      }
    }
    return '';
  },

  /**
   * Resolve Cover Art URL
   */
  resolveCoverUrl(manga, size = '256') {
    if (!manga) return '';
    const mangaId = manga.id;
    let fileName = null;

    if (Array.isArray(manga.relationships)) {
      const coverRel = manga.relationships.find(r => r.type === 'cover_art');
      if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
        fileName = coverRel.attributes.fileName;
      }
    }

    if (!fileName) {
      // Return a stylized SVG placeholder or generic manga art
      return `https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&q=80&auto=format&fit=crop`;
    }

    if (size === 'original') {
      return `${UPLOADS_BASE}/covers/${mangaId}/${fileName}`;
    }
    return `${UPLOADS_BASE}/covers/${mangaId}/${fileName}.${size}.jpg`;
  },

  /**
   * Resolve tags & genres list
   */
  resolveTags(manga) {
    if (!manga || !manga.attributes || !Array.isArray(manga.attributes.tags)) return [];
    return manga.attributes.tags.map(t => ({
      id: t.id,
      name: t.attributes?.name?.en || 'Tag',
      group: t.attributes?.group || 'genre'
    }));
  },

  /**
   * Resolve Author & Artist
   */
  resolveCreators(manga) {
    if (!manga || !Array.isArray(manga.relationships)) return { author: 'Unknown', artist: 'Unknown' };
    const authors = manga.relationships
      .filter(r => r.type === 'author' && r.attributes?.name)
      .map(r => r.attributes.name);
    const artists = manga.relationships
      .filter(r => r.type === 'artist' && r.attributes?.name)
      .map(r => r.attributes.name);

    return {
      author: authors.length > 0 ? authors.join(', ') : 'Unknown',
      artist: artists.length > 0 ? artists.join(', ') : authors.join(', ') || 'Unknown'
    };
  },

  /**
   * Fetch Featured Manga (for Hero carousel)
   */
  async getFeaturedManga() {
    try {
      const res = await this.get('/manga', {
        limit: 6,
        'order[followedCount]': 'desc',
        'includes': ['cover_art', 'author', 'artist'],
        'contentRating': ['safe', 'suggestive'],
        'availableTranslatedLanguage': ['en']
      });
      return res.data || [];
    } catch (e) {
      console.warn('Failed to load live featured manga, using fallback', e);
      return [];
    }
  },

  /**
   * Fetch Trending / Popular manga
   */
  async getTrendingManga(limit = 12, offset = 0) {
    const res = await this.get('/manga', {
      limit,
      offset,
      'order[followedCount]': 'desc',
      'includes': ['cover_art', 'author'],
      'contentRating': ['safe', 'suggestive']
    });
    return res;
  },

  /**
   * Fetch Top Rated manga
   */
  async getTopRatedManga(limit = 12, offset = 0) {
    const res = await this.get('/manga', {
      limit,
      offset,
      'order[rating]': 'desc',
      'includes': ['cover_art', 'author'],
      'contentRating': ['safe', 'suggestive']
    });
    return res;
  },

  /**
   * Fetch Latest updated manga
   */
  async getLatestUpdates(limit = 12, offset = 0) {
    const res = await this.get('/manga', {
      limit,
      offset,
      'order[latestUploadedChapter]': 'desc',
      'includes': ['cover_art'],
      'contentRating': ['safe', 'suggestive']
    });
    return res;
  },

  /**
   * Search Manga with filters
   */
  async searchManga({
    query = '',
    tags = [],
    excludedTags = [],
    status = '',
    demographic = [],
    contentRating = ['safe', 'suggestive'],
    sort = 'followedCount',
    sortOrder = 'desc',
    limit = 24,
    offset = 0
  } = {}) {
    const params = {
      limit,
      offset,
      includes: ['cover_art', 'author'],
      contentRating
    };

    if (query && query.trim()) {
      params.title = query.trim();
    }

    if (tags.length > 0) {
      params.includedTags = tags;
    }

    if (excludedTags.length > 0) {
      params.excludedTags = excludedTags;
    }

    if (status) {
      params.status = [status];
    }

    if (demographic && demographic.length > 0) {
      params.publicationDemographic = demographic;
    }

    // Sort mapping
    params[`order[${sort}]`] = sortOrder;

    return await this.get('/manga', params);
  },

  /**
   * Get single Manga details by ID including cover & stats
   */
  async getMangaDetails(id) {
    const res = await this.get(`/manga/${id}`, {
      includes: ['cover_art', 'author', 'artist']
    });
    const manga = res.data;

    // Fetch stats (ratings and follows)
    try {
      const statsRes = await this.get(`/statistics/manga/${id}`, {}, false);
      if (statsRes && statsRes.statistics && statsRes.statistics[id]) {
        manga.stats = statsRes.statistics[id];
      }
    } catch (e) {
      console.warn('Could not load manga stats', e);
    }

    return manga;
  },

  /**
   * Get Chapters for a manga with language and sort options
   */
  async getMangaChapters(mangaId, {
    language = 'en',
    limit = 100,
    offset = 0,
    order = 'asc',
    includeExternal = 1
  } = {}) {
    const params = {
      limit,
      offset,
      includes: ['scanlation_group', 'user'],
      'order[chapter]': order
    };

    if (language && language !== 'all') {
      params['translatedLanguage'] = [language];
    }

    if (!includeExternal) {
      params.includeExternalUrl = 0;
    }

    const res = await this.get(`/manga/${mangaId}/feed`, params);
    return res;
  },

  /**
   * Get pages for a chapter via MangaDex At-Home network
   */
  async getChapterPages(chapterId) {
    const res = await this.get(`/at-home/server/${chapterId}`, {}, false);
    if (!res || !res.baseUrl || !res.chapter) {
      throw new Error('Chapter data unavailable on server');
    }

    const { baseUrl, chapter } = res;
    const hash = chapter.hash;
    const dataFiles = chapter.data || [];
    const saverFiles = chapter.dataSaver || [];

    if (dataFiles.length === 0 && saverFiles.length === 0) {
      throw new Error('No readable pages found for this chapter.');
    }

    // Build absolute image URLs
    const highQualityUrls = dataFiles.map(file => `${baseUrl}/data/${hash}/${file}`);
    const dataSaverUrls = saverFiles.map(file => `${baseUrl}/data-saver/${hash}/${file}`);

    return {
      baseUrl,
      hash,
      pagesCount: dataFiles.length || saverFiles.length,
      highQualityUrls,
      dataSaverUrls
    };
  },

  /**
   * Get a random Manga
   */
  async getRandomManga() {
    const res = await this.get('/manga/random', {
      includes: ['cover_art', 'author', 'artist'],
      contentRating: ['safe', 'suggestive']
    }, false);
    return res.data;
  }
};
