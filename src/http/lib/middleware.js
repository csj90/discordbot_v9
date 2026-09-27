// Dependencies
const crypto = require('crypto'),
	{ PermissionFlagsBits } = require('discord.js'),
	{ API } = require('../../config'),
	{ getSession } = require('./session');

// Forward errors from async handlers to the error handler
const wrap = (fn) => (req, res, next, ...rest) => Promise.resolve(fn(req, res, next, ...rest)).catch(next);

function safeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	const bufA = Buffer.from(a), bufB = Buffer.from(b);
	return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const isOwner = (bot, userID) => bot.config.ownerID.includes(userID);

// Checked live against the bot's view of the member, not the OAuth2 snapshot
async function canManageGuild(bot, guild, userID) {
	if (isOwner(bot, userID) || guild.ownerId === userID) return true;
	const member = await guild.members.fetch(userID).catch(() => null);
	return member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

const requireSession = wrap(async (req, res, next) => {
	const session = await getSession(req);
	if (!session) return res.status(401).json({ error: 'Not logged in' });
	req.session = session;
	next();
});

// Used with router.param('guildId', ...)
function requireGuild(bot) {
	return wrap(async (req, res, next, guildId) => {
		const guild = bot.guilds.cache.get(guildId);
		if (!guild) return res.status(404).json({ error: 'The bot is not in that server' });
		if (!await canManageGuild(bot, guild, req.session.userID)) {
			return res.status(403).json({ error: 'You need the Manage Server permission' });
		}
		req.guild = guild;
		next();
	});
}

// Server-to-server routes, token in the Authorization header (or ?token= for older clients)
function requireInternalToken(req, res, next) {
	const token = req.get('authorization')?.replace(/^Bearer /, '') ?? req.query.token;
	if (!API.token || !safeEqual(token, API.token)) return res.status(401).json({ error: 'Invalid API token' });
	next();
}

// Reject state-changing requests coming from an unknown browser origin
function checkOrigin(req, res, next) {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
	const origin = req.get('origin');
	if (origin && !(API.corsOrigins ?? []).includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
	next();
}

// Fixed-window rate limiter, keyed by IP unless a key function is given
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
	const hits = new Map();
	setInterval(() => {
		const now = Date.now();
		for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
	}, windowMs).unref();

	return (req, res, next) => {
		const k = key(req), now = Date.now();
		let entry = hits.get(k);
		if (!entry || entry.reset <= now) {
			entry = { count: 0, reset: now + windowMs };
			hits.set(k, entry);
		}
		if (++entry.count > max) {
			res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
			return res.status(429).json({ error: 'Too many requests, slow down' });
		}
		next();
	};
}

// eslint-disable-next-line no-unused-vars
function errorHandler(bot) {
	return (err, req, res, next) => {
		if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
		bot.logger.error(`HTTP ${req.method} ${req.originalUrl}: ${err.message}`);
		res.status(500).json({ error: 'Something went wrong' });
	};
}

module.exports = { wrap, isOwner, canManageGuild, requireSession, requireGuild, requireInternalToken, checkOrigin, rateLimit, errorHandler };
