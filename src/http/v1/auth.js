// Dependencies
const express = require('express'),
	crypto = require('crypto'),
	{ API } = require('../../config'),
	{ clientID, authorizeURL, exchangeCode, fetchUser } = require('../lib/discord'),
	{ cookieOptions, readCookie, createSession, destroySession } = require('../lib/session'),
	{ wrap, rateLimit } = require('../lib/middleware');

// Only the origin of dashboardURL is used, so "https://site.com/dashboard/" still works
const dashboard = () => {
	try {
		return new URL(API.dashboardURL).origin;
	} catch {
		return String(API.dashboardURL ?? '').replace(/\/+$/, '');
	}
};

const STATE_COOKIE = 'csj_oauth_state',
	STATE_PATH = '/v1/auth';

// Only allow redirects back to a path on the dashboard, and never back to a login page (avoids loops)
function safeRedirect(path) {
	if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 200 || /(^|\/)login(\/|\?|$)/.test(path)) {
		return '/dashboard';
	}
	return path;
}

module.exports = (bot) => {
	const router = express.Router(),
		limiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

	// Start Discord OAuth2
	router.get('/login', limiter, (req, res) => {
		const state = crypto.randomBytes(16).toString('hex');
		res.cookie(STATE_COOKIE, `${state}:${safeRedirect(req.query.redirect)}`, cookieOptions(10 * 60 * 1000, STATE_PATH));
		res.redirect(authorizeURL(bot, state));
	});

	// Discord sends the user back here
	router.get('/callback', limiter, wrap(async (req, res) => {
		const stored = readCookie(req, STATE_COOKIE) ?? '',
			split = stored.indexOf(':'),
			state = stored.slice(0, split),
			redirect = safeRedirect(stored.slice(split + 1));
		res.clearCookie(STATE_COOKIE, cookieOptions(undefined, STATE_PATH));

		if (req.query.error) return res.redirect(`${dashboard()}/login?error=denied`);
		if (!req.query.code || split === -1 || req.query.state !== state) return res.redirect(`${dashboard()}/login?error=state`);

		try {
			const token = await exchangeCode(bot, req.query.code),
				user = await fetchUser(token.access_token);
			await createSession(res, { user, accessToken: token.access_token, expiresIn: token.expires_in });
			bot.logger.log(`Dashboard: ${user.username} (${user.id}) logged in.`);
		} catch (err) {
			const reason = err.response?.data?.error ?? err.message;
			bot.logger.error(`Dashboard login failed: ${reason}${reason === 'invalid_client' ? ` (client ID ${clientID(bot)} and API.clientSecret don't belong to the same Discord application)` : ''}`);
			return res.redirect(`${dashboard()}/login?error=discord`);
		}

		res.redirect(`${dashboard()}${redirect}`);
	}));

	router.post('/logout', wrap(async (req, res) => {
		await destroySession(req, res);
		res.json({ success: true });
	}));

	return router;
};
