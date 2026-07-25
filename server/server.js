require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback - must stay after static + api mounting
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ReelMatch server running on http://localhost:${PORT}`);
  if (!process.env.TMDB_API_KEY) {
    console.warn('WARNING: TMDB_API_KEY is not set. Add it to server/.env to enable search and recommendations.');
  }
});
