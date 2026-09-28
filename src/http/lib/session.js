// Dependencies
const crypto = require('crypto'),
	{ SessionSchema } = require('../../database/models'),
	{ API } = require('../../config');

const SESSION_COOKIE = 'csj_session',
	MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Accept things like 'https://csjgaming.com/' or '.csjgaming.com:443' and reduce them to a bare domain.
// Anything still invalid (or localhost) falls back to a host-only cookie instead of breaking every login.
const DOMAIN_RE = /^\.?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
function normalizeDomain(value) {
	if (!value) return undefined;
	const leadingDot = String(value).trim().startsWith('.') ? '.' : '';
	const host = String(value).trim().replace(/^[a-z]+:\/\//i, '').replace(/^\./, '').split(/[/:?#]/)[0];
	const domain = `${leadingDot}${host}`;
	if (!DOMAIN_RE.test(domain)) {
		console.warn(`[API] cookieDomain "${value}" is not a valid cookie domain (expected something like ".csjgaming.com"). Using a host-only cookie.`);
		return undefined;
	}
	// Browsers drop cookies for a domain the API itself isn't under (e.g. API on botapi.x.com, domain bot.x.com)
	let apiHost = '';
	try {
		apiHost = new URL(API.publicURL).hostname;
	} catch {
		return domain;
	}
	if (apiHost !== host && !apiHost.endsWith(`.${host}`)) {
		console.warn(`[API] cookieDomain "${value}" doesn't cover the API host "${apiHost}", browsers would reject it. Use the shared parent, e.g. ".${apiHost.split('.').slice(-2).join('.')}". Using a host-only cookie.`);
		return undefined;
	}
	return domain;
}
const COOKIE_DOMAIN = normalizeDomain(API.cookieDomain);

// Cookie options shared between the API and dashboard
function cookieOptions(maxAge, path = '/') {
	return {
		httpOnly: true,
		secure: (API.publicURL ?? '').startsWith('https://'),
		sameSite: 'lax',
		path,
		domain: COOKIE_DOMAIN,
		maxAge,
	};
}

function readCookie(req, name) {
	const header = req.headers.cookie;
	if (!header) return null;

	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index > -1 && part.slice(0, index).trim() === name) {
			try {
				return decodeURIComponent(part.slice(index + 1).trim());
			} catch {
				return null;
			}
		}
	}
	return null;
}

// Store a new session and hand the user its ID in an httpOnly cookie
async function createSession(res, { user, accessToken, expiresIn }) {
	const id = crypto.randomBytes(32).toString('base64url'),
		maxAge = Math.min(expiresIn * 1000, MAX_AGE);

	await SessionSchema.create({
		hash: hash(id),
		userID: user.id,
		accessToken,
		user: {
			id: user.id,
			username: user.username,
			globalName: user.global_name ?? null,
			avatar: user.avatar ?? null,
		},
		expiresAt: new Date(Date.now() + maxAge),
	});

	res.cookie(SESSION_COOKIE, id, cookieOptions(maxAge));
}

async function getSession(req) {
	const id = readCookie(req, SESSION_COOKIE);
	if (!id) return null;

	const session = await SessionSchema.findOne({ hash: hash(id) }).lean();
	if (!session || session.expiresAt < new Date()) return null;
	return session;
}

async function destroySession(req, res) {
	const id = readCookie(req, SESSION_COOKIE);
	if (id) await SessionSchema.deleteOne({ hash: hash(id) });
	res.clearCookie(SESSION_COOKIE, cookieOptions());
}

module.exports = { cookieOptions, readCookie, createSession, getSession, destroySession };
