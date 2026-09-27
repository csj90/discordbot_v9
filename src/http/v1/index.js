// Dependencies
const express = require('express'),
	cors = require('cors'),
	{ API } = require('../../config'),
	{ checkOrigin, errorHandler } = require('../lib/middleware');

// Dashboard API, the website talks to the bot only through here
module.exports = (bot) => {
	const router = express.Router();

	router.use(cors({ origin: API.corsOrigins ?? [], credentials: true }));
	router.use(checkOrigin);
	router.use(express.json({ limit: '100kb' }));

	router.use('/auth', require('./auth')(bot));
	router.use('/public', require('./public')(bot));
	router.use('/me', require('./me')(bot));
	router.use('/guilds', require('./guilds')(bot));

	router.use((req, res) => res.status(404).json({ error: 'Not found' }));
	router.use(errorHandler(bot));

	return router;
};
