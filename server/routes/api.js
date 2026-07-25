const express = require('express');
const router = express.Router();

const TMDB_BASE = 'https://api.themoviedb.org/3';

let genreCache = null;
let genreCacheAt = 0;
const GENRE_TTL_MS = 1000 * 60 * 60; // 1 hour

function requireKey(req, res, next) {
  if (!process.env.TMDB_API_KEY) {
    return res.status(503).json({
      error: 'missing_api_key',
      message: 'No TMDb API key configured. Add TMDB_API_KEY to server/.env and restart the server.'
    });
  }
  next();
}

async function tmdb(endpoint, params = {}) {
  const url = new URL(TMDB_BASE + endpoint);
  url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.status_message || `TMDb request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function handleError(res, err) {
  const status = err.status && err.status < 500 ? err.status : 502;
  res.status(status).json({ error: 'tmdb_error', message: err.message || 'Unable to reach TMDb.' });
}

// Whether the server has a key configured (frontend uses this to show setup banner)
router.get('/status', (req, res) => {
  res.json({ configured: Boolean(process.env.TMDB_API_KEY) });
});

// Genre list, cached in memory
router.get('/genres', requireKey, async (req, res) => {
  try {
    const now = Date.now();
    if (!genreCache || now - genreCacheAt > GENRE_TTL_MS) {
      const data = await tmdb('/genre/movie/list');
      genreCache = data.genres || [];
      genreCacheAt = now;
    }
    res.json({ genres: genreCache });
  } catch (err) {
    handleError(res, err);
  }
});

// Combined search: movies + people (actors/directors)
router.get('/search', requireKey, async (req, res) => {
  const query = (req.query.q || '').trim();
  const page = req.query.page || 1;
  if (!query) return res.json({ movies: [], people: [] });

  try {
    const data = await tmdb('/search/multi', { query, page, include_adult: false });
    const results = data.results || [];

    const movies = results
      .filter((item) => item.media_type === 'movie' && item.title)
      .map(mapMovieSummary);

    const people = results
      .filter((item) => item.media_type === 'person')
      .map((person) => ({
        id: person.id,
        name: person.name,
        department: person.known_for_department || 'Acting',
        profilePath: person.profile_path,
        popularity: person.popularity,
        knownFor: (person.known_for || [])
          .filter((k) => k.media_type === 'movie')
          .map((k) => k.title)
          .filter(Boolean)
          .slice(0, 3)
      }));

    res.json({ movies, people, page: data.page, totalPages: data.total_pages });
  } catch (err) {
    handleError(res, err);
  }
});

// Discover by one or more genre ids -- powers the "mood" search
router.get('/discover', requireKey, async (req, res) => {
  const { with_genres, sort_by, page, without_genres } = req.query;
  try {
    const data = await tmdb('/discover/movie', {
      with_genres,
      without_genres,
      sort_by: sort_by || 'popularity.desc',
      'vote_count.gte': 80,
      page: page || 1
    });
    res.json({
      movies: (data.results || []).map(mapMovieSummary),
      page: data.page,
      totalPages: data.total_pages
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/trending', requireKey, async (req, res) => {
  try {
    const data = await tmdb('/trending/movie/week', { page: req.query.page || 1 });
    res.json({
      movies: (data.results || []).map(mapMovieSummary),
      page: data.page,
      totalPages: data.total_pages
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/top-rated', requireKey, async (req, res) => {
  try {
    const data = await tmdb('/movie/top_rated', { page: req.query.page || 1 });
    res.json({
      movies: (data.results || []).map(mapMovieSummary),
      page: data.page,
      totalPages: data.total_pages
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/movie/:id', requireKey, async (req, res) => {
  try {
    const data = await tmdb(`/movie/${req.params.id}`, {
      append_to_response: 'credits,videos,similar,release_dates'
    });

    const trailer = (data.videos?.results || []).find(
      (v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
    );

    res.json({
      id: data.id,
      title: data.title,
      tagline: data.tagline,
      overview: data.overview,
      posterPath: data.poster_path,
      backdropPath: data.backdrop_path,
      releaseDate: data.release_date,
      runtime: data.runtime,
      rating: data.vote_average,
      voteCount: data.vote_count,
      genres: data.genres || [],
      status: data.status,
      trailerKey: trailer ? trailer.key : null,
      cast: (data.credits?.cast || []).slice(0, 12).map((c) => ({
        id: c.id,
        name: c.name,
        character: c.character,
        profilePath: c.profile_path
      })),
      directors: (data.credits?.crew || [])
        .filter((c) => c.job === 'Director')
        .map((c) => ({ id: c.id, name: c.name })),
      similar: (data.similar?.results || []).slice(0, 10).map(mapMovieSummary)
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/person/:id', requireKey, async (req, res) => {
  try {
    const [details, credits] = await Promise.all([
      tmdb(`/person/${req.params.id}`),
      tmdb(`/person/${req.params.id}/movie_credits`)
    ]);

    const actingCredits = dedupeByMovie(credits.cast || [])
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .map(mapMovieSummary);

    const directingCredits = dedupeByMovie(
      (credits.crew || []).filter((c) => c.job === 'Director')
    )
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .map(mapMovieSummary);

    res.json({
      id: details.id,
      name: details.name,
      biography: details.biography,
      profilePath: details.profile_path,
      birthday: details.birthday,
      placeOfBirth: details.place_of_birth,
      knownFor: details.known_for_department,
      acting: actingCredits,
      directing: directingCredits
    });
  } catch (err) {
    handleError(res, err);
  }
});

function dedupeByMovie(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function mapMovieSummary(movie) {
  return {
    id: movie.id,
    title: movie.title,
    posterPath: movie.poster_path,
    backdropPath: movie.backdrop_path,
    releaseDate: movie.release_date,
    rating: movie.vote_average,
    overview: movie.overview,
    genreIds: movie.genre_ids || []
  };
}

module.exports = router;
