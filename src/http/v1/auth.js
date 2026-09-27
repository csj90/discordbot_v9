// Dependencies
const express = require('express'),
	crypto = require('crypto'),
	{ API } = require('../../config'),
	{ authorizeURL, exchangeCode, fetchUser } = require('../lib/discord'),
	{ cookieOptions, readCookie, createSession, destroySession } = require('../lib/session'),
	{ wrap, rateLimit } = require('../lib/middleware');

const STATE_COOKIE = 'csj_oauth_state',
	STATE_PATH = '/v1/auth';

// Only allow redirects back to a path on the dashboard
function safeRedirect(path) {
	if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 200) {
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

		if (req.query.error) return res.redirect(`${API.dashboardURL}/login?error=denied`);
		if (!req.query.code || split === -1 || req.query.state !== state) return res.redirect(`${API.dashboardURL}/login?error=state`);

		try {
			const token = await exchangeCode(bot, req.query.code),
				user = await fetchUser(token.access_token);
			await createSession(res, { user, accessToken: token.access_token, expiresIn: token.expires_in });
			bot.logger.log(`Dashboard: ${user.username} (${user.id}) logged in.`);
		} catch (err) {
			bot.logger.error(`Dashboard login failed: ${err.response?.data?.error ?? err.message}`);
			return res.redirect(`${API.dashboardURL}/login?error=discord`);
		}

		res.redirect(`${API.dashboardURL}${redirect}`);
	}));

	router.post('/logout', wrap(async (req, res) => {
		await destroySession(req, res);
		res.json({ success: true });
	}));

	return router;
};
