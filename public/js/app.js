(function () {
  'use strict';

  /* ============================================================
     CONSTANTS
     ============================================================ */
  var WATCHLIST_KEY = 'reelmatch_watchlist';
  var RECENT_KEY = 'reelmatch_recent';
  var IMG_ROOT = 'https://image.tmdb.org/t/p/';

  var MOOD_DEFS = [
    { label: 'Feel Good', tag: 'Comfort watch', genres: ['Comedy', 'Family'] },
    { label: 'Heart Racing', tag: 'Pulse up', genres: ['Action', 'Thriller'] },
    { label: 'Mind Bending', tag: 'Think after', genres: ['Science Fiction', 'Mystery'] },
    { label: 'Tears & Feels', tag: 'Bring tissues', genres: ['Drama', 'Romance'] },
    { label: 'Spooky Night', tag: 'Lights off', genres: ['Horror'] },
    { label: 'Epic Adventure', tag: 'Go big', genres: ['Adventure', 'Fantasy'] },
    { label: 'True Stories', tag: 'Based on fact', genres: ['Documentary', 'History'] },
    { label: 'Edge Of Seat', tag: 'No pausing', genres: ['Thriller', 'Crime'] },
    { label: 'Animated Fun', tag: 'All ages', genres: ['Animation'] }
  ];
  var QUICK_MOOD_LABELS = ['Feel Good', 'Heart Racing', 'Mind Bending', 'Tears & Feels', 'Spooky Night'];

  /* ============================================================
     STATE
     ============================================================ */
  var genreIdToName = {};
  var genreNameToId = {};
  var movieCache = new Map();
  var currentContext = null;
  var topRatedState = { page: 1, totalPages: 1 };
  var lastFocusedElement = null;
  var toastTimer = null;

  /* ============================================================
     DOM REFS
     ============================================================ */
  var el = {};
  [
    'setupBanner', 'dismissBanner', 'navSearchToggle', 'navWatchlistCount',
    'mobileMenuToggle', 'mobileMenu',
    'searchForm', 'searchInput', 'searchClear', 'searchDropdown', 'quickMoods', 'surpriseBtn',
    'resultsSection', 'resultsEyebrow', 'resultsTitle', 'resultsSort', 'closeResults',
    'peopleRow', 'resultsGrid', 'loadMoreResults', 'resultsEmpty',
    'trendingTrack',
    'recentSection', 'recentGrid',
    'moodGrid',
    'topRatedGrid', 'loadMoreTopRated',
    'watchlistGrid', 'watchlistEmpty', 'clearWatchlist',
    'footerClearAll', 'backToTop', 'year',
    'modalOverlay', 'modal', 'modalClose', 'modalBody',
    'toast'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  /* ============================================================
     UTILITIES
     ============================================================ */
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, delay);
    };
  }

  function imgUrl(path, size) {
    if (!path) return null;
    return IMG_ROOT + (size || 'w342') + path;
  }

  function yearOf(dateStr) {
    return dateStr ? dateStr.slice(0, 4) : 'TBA';
  }

  function formatRuntime(mins) {
    if (!mins) return '';
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h ? (h + 'h ' + m + 'm') : (m + 'm');
  }

  function genreNamesFor(ids) {
    return (ids || []).map(function (id) { return genreIdToName[id]; }).filter(Boolean);
  }

  function findGenreId(name) {
    return genreNameToId[name.toLowerCase()] || null;
  }

  function movieMetaLine(movie) {
    var parts = [yearOf(movie.releaseDate)];
    var genres = genreNamesFor(movie.genreIds).slice(0, 1);
    return parts.concat(genres).filter(Boolean).join(' · ');
  }

  function clientSort(arr, val) {
    var copy = arr.slice();
    if (val === 'vote_average.desc') {
      copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    } else if (val === 'primary_release_date.desc') {
      copy.sort(function (a, b) { return (b.releaseDate || '').localeCompare(a.releaseDate || ''); });
    }
    return copy;
  }

  async function fetchJSON(url) {
    var res = await fetch(url);
    var data = {};
    try { data = await res.json(); } catch (e) { /* noop */ }
    if (!res.ok) {
      throw new Error(data.message || 'Something went wrong. Please try again.');
    }
    return data;
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }

  /* ============================================================
     LOCAL STORAGE: WATCHLIST + RECENTLY VIEWED
     ============================================================ */
  function getWatchlist() {
    try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || []; }
    catch (e) { return []; }
  }
  function setWatchlist(list) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    el.navWatchlistCount.textContent = list.length;
  }
  function isSaved(id) {
    return getWatchlist().some(function (m) { return m.id === id; });
  }
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
    catch (e) { return []; }
  }
  function addRecent(movie) {
    var list = getRecent().filter(function (m) { return m.id !== movie.id; });
    list.unshift(movie);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  }

  function toggleWatchlist(id) {
    var list = getWatchlist();
    var idx = list.findIndex(function (m) { return m.id === id; });
    var saved;
    if (idx > -1) {
      list.splice(idx, 1);
      saved = false;
    } else {
      var movie = movieCache.get(id);
      if (!movie) return;
      list.unshift(movie);
      saved = true;
    }
    setWatchlist(list);
    syncSaveButtons(id, saved);
    renderWatchlistSection();
    showToast(saved ? 'Added to your watchlist' : 'Removed from your watchlist');
  }

  function syncSaveButtons(id, saved) {
    document.querySelectorAll('[data-action="toggle-save"][data-id="' + id + '"]').forEach(function (btn) {
      btn.classList.toggle('is-saved', saved);
      if (btn.classList.contains('movie-card__save')) {
        btn.textContent = saved ? '✓' : '+';
        btn.setAttribute('aria-label', saved ? 'Remove from watchlist' : 'Add to watchlist');
      } else if (btn.classList.contains('primary-btn')) {
        btn.textContent = saved ? '✓ Saved to watchlist' : '+ Add to watchlist';
      }
    });
  }

  /* ============================================================
     CARD BUILDERS
     ============================================================ */
  function createMovieCardHTML(movie) {
    var poster = imgUrl(movie.posterPath, 'w342');
    var saved = isSaved(movie.id);
    var rating = movie.rating ? movie.rating.toFixed(1) : null;
    return (
      '<div class="movie-card">' +
        '<div class="movie-card__poster-wrap">' +
          (poster
            ? '<img class="movie-card__poster" loading="lazy" src="' + poster + '" alt="' + escapeHtml(movie.title) + ' poster">'
            : '<div class="movie-card__poster-fallback">' + escapeHtml(movie.title) + '</div>') +
          (rating ? '<span class="movie-card__rating">' + rating + '</span>' : '') +
          '<button type="button" class="movie-card__save ' + (saved ? 'is-saved' : '') + '" data-action="toggle-save" data-id="' + movie.id + '" aria-label="' + (saved ? 'Remove from watchlist' : 'Add to watchlist') + '">' + (saved ? '✓' : '+') + '</button>' +
        '</div>' +
        '<div class="movie-card__body">' +
          '<p class="movie-card__title">' + escapeHtml(movie.title) + '</p>' +
          '<p class="movie-card__meta">' + escapeHtml(movieMetaLine(movie)) + '</p>' +
        '</div>' +
        '<button type="button" class="movie-card__btn" data-action="open-movie" data-id="' + movie.id + '" aria-label="View details for ' + escapeHtml(movie.title) + '"></button>' +
      '</div>'
    );
  }

  function createPersonCardHTML(person) {
    var photo = imgUrl(person.profilePath, 'w185');
    return (
      '<button type="button" class="person-card" data-action="open-person" data-id="' + person.id + '">' +
        (photo ? '<img class="person-card__photo" src="' + photo + '" alt="' + escapeHtml(person.name) + '">' : '<div class="person-card__photo"></div>') +
        '<p class="person-card__name">' + escapeHtml(person.name) + '</p>' +
        '<p class="person-card__role">' + escapeHtml(person.department || '') + '</p>' +
      '</button>'
    );
  }

  function renderMovieGridInto(node, movies) {
    node.innerHTML = movies.map(function (m) {
      movieCache.set(m.id, m);
      return createMovieCardHTML(m);
    }).join('');
  }

  /* ============================================================
     WATCHLIST / RECENT SECTIONS
     ============================================================ */
  function renderWatchlistSection() {
    var list = getWatchlist();
    renderMovieGridInto(el.watchlistGrid, list);
    el.watchlistEmpty.hidden = list.length > 0;
    el.navWatchlistCount.textContent = list.length;
  }

  function renderRecentSection() {
    var list = getRecent();
    el.recentSection.hidden = list.length === 0;
    renderMovieGridInto(el.recentGrid, list);
  }

  /* ============================================================
     GENRES + MOODS
     ============================================================ */
  async function loadGenres() {
    try {
      var data = await fetchJSON('/api/genres');
      (data.genres || []).forEach(function (g) {
        genreIdToName[g.id] = g.name;
        genreNameToId[g.name.toLowerCase()] = g.id;
      });
    } catch (err) { /* leave maps empty; UI shows fallback copy */ }
    buildMoodGrid();
    buildQuickMoods();
  }

  function moodToCard(mood) {
    var matchedIds = [];
    var matchedNames = [];
    mood.genres.forEach(function (name) {
      var id = findGenreId(name);
      if (id) { matchedIds.push(id); matchedNames.push(name); }
    });
    if (!matchedIds.length) return null;
    return { mood: mood, ids: matchedIds, names: matchedNames };
  }

  function buildMoodGrid() {
    if (!Object.keys(genreIdToName).length) {
      el.moodGrid.innerHTML = '<p class="loading-row">Add your TMDb API key to unlock mood search.</p>';
      return;
    }
    var html = MOOD_DEFS.map(function (mood) {
      var built = moodToCard(mood);
      if (!built) return '';
      return (
        '<button type="button" class="mood-card" data-action="run-mood" data-genres="' + built.ids.join(',') + '" data-label="' + escapeHtml(mood.label) + '">' +
          '<div class="mood-card__top"><span class="mood-card__label">' + escapeHtml(mood.tag) + '</span></div>' +
          '<p class="mood-card__title">' + escapeHtml(mood.label) + '</p>' +
          '<div class="mood-card__divider"></div>' +
          '<p class="mood-card__genres">' + escapeHtml(built.names.join(' · ')) + '</p>' +
        '</button>'
      );
    }).filter(Boolean).join('');
    el.moodGrid.innerHTML = html || '<p class="loading-row">Moods unavailable right now.</p>';
  }

  function buildQuickMoods() {
    if (!Object.keys(genreIdToName).length) {
      el.quickMoods.closest('.hero__chips').hidden = true;
      return;
    }
    var html = MOOD_DEFS
      .filter(function (m) { return QUICK_MOOD_LABELS.indexOf(m.label) > -1; })
      .map(function (mood) {
        var built = moodToCard(mood);
        if (!built) return '';
        return '<button type="button" class="chip" data-action="run-mood" data-genres="' + built.ids.join(',') + '" data-label="' + escapeHtml(mood.label) + '">' + escapeHtml(mood.label) + '</button>';
      }).filter(Boolean).join('');
    el.quickMoods.innerHTML = html;
  }

  /* ============================================================
     TRENDING / TOP RATED
     ============================================================ */
  async function loadTrending() {
    try {
      var data = await fetchJSON('/api/trending');
      var movies = data.movies || [];
      el.trendingTrack.innerHTML = movies.map(function (m) {
        movieCache.set(m.id, m);
        return createMovieCardHTML(m);
      }).join('') || '<p class="loading-row">No trending titles available right now.</p>';
    } catch (err) {
      el.trendingTrack.innerHTML = '<p class="loading-row">' + escapeHtml(err.message || 'Trending titles unavailable.') + '</p>';
    }
  }

  async function loadTopRated(page, append) {
    page = page || 1;
    try {
      var data = await fetchJSON('/api/top-rated?page=' + page);
      topRatedState.page = data.page || page;
      topRatedState.totalPages = data.totalPages || 1;
      var html = (data.movies || []).map(function (m) {
        movieCache.set(m.id, m);
        return createMovieCardHTML(m);
      }).join('');
      if (append) el.topRatedGrid.insertAdjacentHTML('beforeend', html);
      else el.topRatedGrid.innerHTML = html || '<p class="loading-row">No titles available.</p>';
      el.loadMoreTopRated.hidden = !(topRatedState.page < topRatedState.totalPages);
    } catch (err) {
      el.topRatedGrid.innerHTML = '<p class="loading-row">' + escapeHtml(err.message || 'Top rated titles unavailable.') + '</p>';
      el.loadMoreTopRated.hidden = true;
    }
  }

  /* ============================================================
     RESULTS SECTION (search / mood / person)
     ============================================================ */
  function showResultsSection() {
    el.resultsSection.hidden = false;
    el.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function runFullSearch(query, page, append) {
    page = page || 1;
    showResultsSection();
    el.resultsEyebrow.textContent = 'Search results';
    el.resultsTitle.textContent = 'Searching for \u201C' + query + '\u201D\u2026';
    if (!append) {
      el.resultsGrid.innerHTML = '';
      el.peopleRow.innerHTML = '';
      el.peopleRow.hidden = true;
      el.resultsEmpty.hidden = true;
    }
    try {
      var data = await fetchJSON('/api/search?q=' + encodeURIComponent(query) + '&page=' + page);
      if (append && currentContext && currentContext.type === 'search') {
        currentContext.movies = currentContext.movies.concat(data.movies || []);
      } else {
        currentContext = { type: 'search', query: query, movies: data.movies || [], people: data.people || [] };
      }
      currentContext.page = data.page || page;
      currentContext.totalPages = data.totalPages || 1;

      el.resultsTitle.textContent = 'Matches for \u201C' + query + '\u201D';
      if (currentContext.people.length) {
        el.peopleRow.hidden = false;
        el.peopleRow.innerHTML = currentContext.people.map(createPersonCardHTML).join('');
      } else {
        el.peopleRow.hidden = true;
      }
      renderMovieGridInto(el.resultsGrid, currentContext.movies);
      el.resultsEmpty.hidden = currentContext.movies.length > 0;
      el.resultsEmpty.textContent = 'No matches yet. Try a different title, name, or mood.';
      el.loadMoreResults.hidden = !(currentContext.page < currentContext.totalPages);
      el.resultsSort.value = 'popularity.desc';
    } catch (err) {
      el.resultsTitle.textContent = 'Search unavailable';
      el.resultsEmpty.hidden = false;
      el.resultsEmpty.textContent = err.message || 'Something went wrong.';
      el.loadMoreResults.hidden = true;
    }
  }

  async function fetchDiscover(ids, sortBy, page, append, label) {
    showResultsSection();
    el.resultsEyebrow.textContent = 'Mood pick';
    el.resultsTitle.textContent = label ? ('Finding ' + label.toLowerCase() + ' picks\u2026') : 'Finding picks\u2026';
    el.peopleRow.hidden = true;
    el.peopleRow.innerHTML = '';
    if (!append) el.resultsGrid.innerHTML = '';
    try {
      var data = await fetchJSON('/api/discover?with_genres=' + ids.join(',') + '&sort_by=' + sortBy + '&page=' + page);
      if (append && currentContext && currentContext.type === 'mood') {
        currentContext.movies = currentContext.movies.concat(data.movies || []);
      } else {
        currentContext = { type: 'mood', genreIds: ids, label: label, movies: data.movies || [] };
      }
      currentContext.sort = sortBy;
      currentContext.page = data.page || page;
      currentContext.totalPages = data.totalPages || 1;

      el.resultsTitle.textContent = label ? (label + ' picks') : 'Recommended picks';
      renderMovieGridInto(el.resultsGrid, currentContext.movies);
      el.resultsEmpty.hidden = currentContext.movies.length > 0;
      el.resultsEmpty.textContent = 'No matches yet. Try a different title, name, or mood.';
      el.loadMoreResults.hidden = !(currentContext.page < currentContext.totalPages);
      el.resultsSort.value = sortBy;
    } catch (err) {
      el.resultsTitle.textContent = 'Could not load picks';
      el.resultsEmpty.hidden = false;
      el.resultsEmpty.textContent = err.message || 'Add your TMDb API key to unlock mood search.';
      el.loadMoreResults.hidden = true;
    }
  }

  async function openPersonResults(id) {
    closeDropdown();
    showResultsSection();
    el.resultsEyebrow.textContent = 'Filmography';
    el.resultsTitle.textContent = 'Loading\u2026';
    el.peopleRow.hidden = false;
    el.peopleRow.innerHTML = '<p class="loading-row">Loading profile\u2026</p>';
    el.resultsGrid.innerHTML = '';
    el.loadMoreResults.hidden = true;
    el.resultsEmpty.hidden = true;
    try {
      var data = await fetchJSON('/api/person/' + id);
      currentContext = {
        type: 'person',
        name: data.name,
        acting: data.acting || [],
        directing: data.directing || [],
        activeTab: (data.acting || []).length ? 'acting' : 'directing'
      };
      el.resultsTitle.textContent = data.name;
      el.resultsEyebrow.textContent = data.knownFor ? (data.knownFor + ' \u00B7 Filmography') : 'Filmography';
      renderPersonHeader(data);
      renderActivePersonTab();
      el.resultsSort.value = 'popularity.desc';
    } catch (err) {
      el.resultsTitle.textContent = 'Could not load this profile';
      el.peopleRow.innerHTML = '';
      el.resultsEmpty.hidden = false;
      el.resultsEmpty.textContent = err.message || 'Something went wrong.';
    }
  }

  function renderPersonHeader(data) {
    var photo = imgUrl(data.profilePath, 'w185');
    var showTabs = (data.acting || []).length && (data.directing || []).length;
    var html = '<div class="person-header">' +
      (photo ? '<img class="person-photo" src="' + photo + '" alt="' + escapeHtml(data.name) + '">' : '<div class="person-photo"></div>') +
      '<div><p class="modal-tagline" style="margin:0;">' + escapeHtml(data.placeOfBirth || '') + '</p></div>' +
    '</div>';
    if (data.biography) {
      html += '<p class="person-bio">' + escapeHtml(data.biography) + '</p>';
    }
    if (showTabs) {
      html += '<div class="tabs">' +
        '<button type="button" class="tab-btn ' + (currentContext.activeTab === 'acting' ? 'is-active' : '') + '" data-action="person-tab" data-tab="acting">Acting (' + data.acting.length + ')</button>' +
        '<button type="button" class="tab-btn ' + (currentContext.activeTab === 'directing' ? 'is-active' : '') + '" data-action="person-tab" data-tab="directing">Directing (' + data.directing.length + ')</button>' +
      '</div>';
    }
    el.peopleRow.hidden = false;
    el.peopleRow.innerHTML = html;
  }

  function renderActivePersonTab() {
    var arr = currentContext.activeTab === 'acting' ? currentContext.acting : currentContext.directing;
    renderMovieGridInto(el.resultsGrid, arr);
    el.resultsEmpty.hidden = arr.length > 0;
    el.resultsEmpty.textContent = 'No titles found in this category.';
    el.loadMoreResults.hidden = true;
  }

  /* ============================================================
     SEARCH DROPDOWN
     ============================================================ */
  function closeDropdown() {
    el.searchDropdown.hidden = true;
    el.searchDropdown.innerHTML = '';
  }

  function renderDropdown(movies, people, query) {
    var html = '';
    if (!movies.length && !people.length) {
      html = '<p class="dropdown-empty">No matches for \u201C' + escapeHtml(query) + '\u201D.</p>';
    } else {
      if (movies.length) {
        html += '<p class="dropdown-group-label">Movies</p>';
        html += movies.slice(0, 5).map(function (m) {
          var thumb = imgUrl(m.posterPath, 'w92');
          return '<button type="button" class="dropdown-item" data-action="open-movie" data-id="' + m.id + '">' +
            (thumb ? '<img class="dropdown-item__thumb" src="' + thumb + '" alt="">' : '<div class="dropdown-item__thumb"></div>') +
            '<span class="dropdown-item__text">' +
              '<span class="dropdown-item__title">' + escapeHtml(m.title) + '</span>' +
              '<span class="dropdown-item__meta">' + yearOf(m.releaseDate) + '</span>' +
            '</span>' +
          '</button>';
        }).join('');
      }
      if (people.length) {
        html += '<p class="dropdown-group-label">People</p>';
        html += people.slice(0, 4).map(function (p) {
          var thumb = imgUrl(p.profilePath, 'w92');
          var meta = p.department + (p.knownFor && p.knownFor.length ? ' \u00B7 ' + p.knownFor.join(', ') : '');
          return '<button type="button" class="dropdown-item" data-action="open-person" data-id="' + p.id + '">' +
            (thumb ? '<img class="dropdown-item__thumb dropdown-item__thumb--round" src="' + thumb + '" alt="">' : '<div class="dropdown-item__thumb dropdown-item__thumb--round"></div>') +
            '<span class="dropdown-item__text">' +
              '<span class="dropdown-item__title">' + escapeHtml(p.name) + '</span>' +
              '<span class="dropdown-item__meta">' + escapeHtml(meta) + '</span>' +
            '</span>' +
          '</button>';
        }).join('');
      }
    }
    movies.forEach(function (m) { movieCache.set(m.id, m); });
    el.searchDropdown.innerHTML = html;
    el.searchDropdown.hidden = false;
  }

  var debouncedSearch = debounce(async function (query) {
    if (query.length < 2) { closeDropdown(); return; }
    try {
      var data = await fetchJSON('/api/search?q=' + encodeURIComponent(query));
      renderDropdown(data.movies || [], data.people || [], query);
    } catch (err) {
      el.searchDropdown.innerHTML = '<p class="dropdown-empty">' + escapeHtml(err.message || 'Search unavailable right now.') + '</p>';
      el.searchDropdown.hidden = false;
    }
  }, 350);

  /* ============================================================
     MODAL (movie detail)
     ============================================================ */
  function buildMovieModalHTML(data) {
    var backdrop = imgUrl(data.backdropPath, 'w1280');
    var poster = imgUrl(data.posterPath, 'w342');
    var saved = isSaved(data.id);
    var directors = (data.directors || []).map(function (d) { return d.name; }).join(', ');
    var genresLine = (data.genres || []).map(function (g) { return g.name; }).join(', ');
    var trailerBtn = data.trailerKey
      ? '<a class="trailer-btn" href="https://www.youtube.com/watch?v=' + data.trailerKey + '" target="_blank" rel="noopener">\u25B6 Watch trailer</a>'
      : '';

    var castHTML = '';
    if ((data.cast || []).length) {
      castHTML = '<p class="modal-section-label">Cast</p><div class="cast-grid">' +
        data.cast.map(function (c) {
          var photo = imgUrl(c.profilePath, 'w185');
          return '<div class="cast-item">' +
            (photo ? '<img class="cast-item__photo" src="' + photo + '" alt="' + escapeHtml(c.name) + '">' : '<div class="cast-item__photo"></div>') +
            '<p class="cast-item__name">' + escapeHtml(c.name) + '</p>' +
            '<p class="cast-item__role">' + escapeHtml(c.character || '') + '</p>' +
          '</div>';
        }).join('') + '</div>';
    }

    var similarHTML = '';
    if ((data.similar || []).length) {
      similarHTML = '<p class="modal-section-label">More like this</p><div class="similar-row">' +
        data.similar.map(function (s) {
          movieCache.set(s.id, s);
          return createMovieCardHTML(s);
        }).join('') + '</div>';
    }

    return (
      (backdrop ? '<div class="modal-hero" style="background-image:url(\'' + backdrop + '\')"></div>' : '<div class="modal-hero-empty"></div>') +
      '<div class="modal-content">' +
        '<div class="modal-title-row">' +
          (poster ? '<img class="modal-poster" src="' + poster + '" alt="' + escapeHtml(data.title) + ' poster">' : '') +
          '<div>' +
            '<h3 id="modalTitle">' + escapeHtml(data.title) + '</h3>' +
            (data.tagline ? '<p class="modal-tagline">' + escapeHtml(data.tagline) + '</p>' : '') +
          '</div>' +
        '</div>' +
        '<div class="modal-meta">' +
          '<span>' + yearOf(data.releaseDate) + '</span>' +
          (data.runtime ? '<span>' + formatRuntime(data.runtime) + '</span>' : '') +
          (data.rating ? '<span>\u2605 ' + data.rating.toFixed(1) + ' / 10</span>' : '') +
          (genresLine ? '<span>' + escapeHtml(genresLine) + '</span>' : '') +
          (directors ? '<span>Dir. ' + escapeHtml(directors) + '</span>' : '') +
        '</div>' +
        '<p class="modal-overview">' + escapeHtml(data.overview || 'No synopsis available yet.') + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="primary-btn ' + (saved ? 'is-saved' : '') + '" data-action="toggle-save" data-id="' + data.id + '">' +
            (saved ? '\u2713 Saved to watchlist' : '+ Add to watchlist') +
          '</button>' +
          trailerBtn +
        '</div>' +
        castHTML +
        similarHTML +
      '</div>'
    );
  }

  async function openMovieModal(id) {
    lastFocusedElement = document.activeElement;
    el.modalOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    el.modalBody.innerHTML = '<p class="loading-row">Loading\u2026</p>';
    el.modalClose.focus();
    try {
      var data = await fetchJSON('/api/movie/' + id);
      var summary = {
        id: data.id,
        title: data.title,
        posterPath: data.posterPath,
        releaseDate: data.releaseDate,
        rating: data.rating,
        genreIds: (data.genres || []).map(function (g) { return g.id; })
      };
      movieCache.set(data.id, summary);
      el.modalBody.innerHTML = buildMovieModalHTML(data);
      addRecent(summary);
      renderRecentSection();
    } catch (err) {
      el.modalBody.innerHTML = '<div class="modal-content" style="padding-top:40px;"><p class="empty-state">' + escapeHtml(err.message || 'Could not load this title.') + '</p></div>';
    }
  }

  function closeModal() {
    el.modalOverlay.hidden = true;
    document.body.style.overflow = '';
    el.modalBody.innerHTML = '';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  function trapTabKey(e) {
    if (e.key !== 'Tab') return;
    var focusables = el.modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  /* ============================================================
     SURPRISE ME
     ============================================================ */
  async function surpriseMe() {
    try {
      var page = Math.floor(Math.random() * 20) + 1;
      var data = await fetchJSON('/api/discover?sort_by=popularity.desc&page=' + page);
      var movies = data.movies || [];
      if (!movies.length) throw new Error('No picks available right now.');
      var pick = movies[Math.floor(Math.random() * movies.length)];
      openMovieModal(pick.id);
    } catch (err) {
      showToast(err.message || 'Could not find a pick right now.');
    }
  }

  /* ============================================================
     GLOBAL EVENT DELEGATION
     ============================================================ */
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    var id = target.dataset.id ? Number(target.dataset.id) : null;

    if (action === 'open-movie') {
      e.preventDefault();
      closeDropdown();
      openMovieModal(id);
    } else if (action === 'toggle-save') {
      e.preventDefault();
      e.stopPropagation();
      toggleWatchlist(id);
    } else if (action === 'open-person') {
      e.preventDefault();
      closeDropdown();
      openPersonResults(id);
    } else if (action === 'run-mood') {
      e.preventDefault();
      var ids = (target.dataset.genres || '').split(',').filter(Boolean);
      var label = target.dataset.label;
      if (!ids.length) return;
      fetchDiscover(ids, 'popularity.desc', 1, false, label);
    } else if (action === 'person-tab') {
      e.preventDefault();
      currentContext.activeTab = target.dataset.tab;
      el.peopleRow.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tab === currentContext.activeTab);
      });
      renderActivePersonTab();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search')) closeDropdown();
  });

  // Escape + tab-trap handling
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!el.modalOverlay.hidden) closeModal();
      else if (!el.searchDropdown.hidden) closeDropdown();
    }
    if (e.key === 'Tab' && !el.modalOverlay.hidden) trapTabKey(e);
  });

  /* ============================================================
     WIRE UP STATIC CONTROLS
     ============================================================ */
  el.searchInput.addEventListener('input', function (e) {
    var val = e.target.value.trim();
    el.searchClear.hidden = !val;
    debouncedSearch(val);
  });

  el.searchClear.addEventListener('click', function () {
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    closeDropdown();
    el.searchInput.focus();
  });

  el.searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var query = el.searchInput.value.trim();
    if (!query) return;
    closeDropdown();
    runFullSearch(query, 1, false);
  });

  el.loadMoreResults.addEventListener('click', function () {
    if (!currentContext) return;
    if (currentContext.type === 'mood') {
      fetchDiscover(currentContext.genreIds, currentContext.sort || 'popularity.desc', currentContext.page + 1, true, currentContext.label);
    } else if (currentContext.type === 'search') {
      runFullSearch(currentContext.query, currentContext.page + 1, true);
    }
  });

  el.resultsSort.addEventListener('change', function () {
    if (!currentContext) return;
    var val = el.resultsSort.value;
    if (currentContext.type === 'mood') {
      fetchDiscover(currentContext.genreIds, val, 1, false, currentContext.label);
    } else if (currentContext.type === 'search') {
      currentContext.movies = clientSort(currentContext.movies, val);
      renderMovieGridInto(el.resultsGrid, currentContext.movies);
    } else if (currentContext.type === 'person') {
      var key = currentContext.activeTab;
      currentContext[key] = clientSort(currentContext[key], val);
      renderActivePersonTab();
    }
  });

  el.closeResults.addEventListener('click', function () {
    el.resultsSection.hidden = true;
    currentContext = null;
  });

  el.loadMoreTopRated.addEventListener('click', function () {
    loadTopRated(topRatedState.page + 1, true);
  });

  el.clearWatchlist.addEventListener('click', function () {
    if (!getWatchlist().length) return;
    if (confirm('Clear your entire watchlist?')) {
      setWatchlist([]);
      renderWatchlistSection();
      showToast('Watchlist cleared');
    }
  });

  el.footerClearAll.addEventListener('click', function () {
    if (confirm('Reset all locally saved data (watchlist + recently viewed)?')) {
      localStorage.removeItem(WATCHLIST_KEY);
      localStorage.removeItem(RECENT_KEY);
      renderWatchlistSection();
      renderRecentSection();
      showToast('Local data reset');
    }
  });

  el.backToTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.surpriseBtn.addEventListener('click', surpriseMe);

  el.modalClose.addEventListener('click', closeModal);
  el.modalOverlay.addEventListener('click', function (e) {
    if (e.target === el.modalOverlay) closeModal();
  });

  el.mobileMenuToggle.addEventListener('click', function () {
    var isOpen = el.mobileMenu.classList.toggle('is-open');
    el.mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  el.mobileMenu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      el.mobileMenu.classList.remove('is-open');
      el.mobileMenuToggle.setAttribute('aria-expanded', 'false');
    });
  });

  el.navSearchToggle.addEventListener('click', function () {
    document.querySelector('.hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { el.searchInput.focus(); }, 400);
  });

  el.dismissBanner.addEventListener('click', function () {
    el.setupBanner.hidden = true;
    sessionStorage.setItem('reelmatch_banner_dismissed', '1');
  });

  /* ============================================================
     INIT
     ============================================================ */
  async function checkStatus() {
    try {
      var data = await fetchJSON('/api/status');
      if (!data.configured && !sessionStorage.getItem('reelmatch_banner_dismissed')) {
        el.setupBanner.hidden = false;
      }
    } catch (err) { /* ignore */ }
  }

  function init() {
    el.year.textContent = new Date().getFullYear();
    checkStatus();
    loadGenres();
    loadTrending();
    loadTopRated(1, false);
    renderWatchlistSection();
    renderRecentSection();
  }

  init();
})();
