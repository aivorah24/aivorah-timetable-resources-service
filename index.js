require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { requireUser } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'aivorah-timetable-resources-service' }));

app.use('/timetable', requireUser, require('./routes/timetable'));
app.use('/resources', requireUser, require('./routes/resources'));
app.use('/uploads', requireUser, require('./routes/uploads'));

const PORT = process.env.PORT || 3021;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Aivorah Timetable & Resources service on http://localhost:${PORT}`));
}

module.exports = app;
