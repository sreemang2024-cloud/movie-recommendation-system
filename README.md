# ReelMatch — Movie Recommendation Engine

## Setup
1. `cd movie-recommendation-app`
2. `npm install`
3. `cp server/.env.example server/.env`
4. Get a free TMDb v3 API key: https://www.themoviedb.org/settings/api → paste it into `server/.env` as `TMDB_API_KEY`
5. `npm start`
6. Open `http://localhost:5000`

## Notes
- Runs without a key too — UI loads, but search/moods/trending show a setup message until the key is added.
- Watchlist and recently-viewed are stored in the browser's `localStorage` (per browser, not synced).
- Data provided by TMDb (https://www.themoviedb.org). This product uses the TMDb API but is not endorsed or certified by TMDb.

## Structure
```
movie-recommendation-app/
├── package.json
├── server/
│   ├── server.js          # Express entry point + static hosting
│   ├── .env.example        # copy to .env and add TMDB_API_KEY
│   └── routes/api.js       # TMDb proxy: search, genres, discover, trending, top-rated, movie, person
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js            # all client logic (search, moods, modal, watchlist, etc.)
```
