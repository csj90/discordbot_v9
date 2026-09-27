// Dependencies
const crypto = require('crypto'),
	{ SessionSchema } = require('../../database/models'),
	{ API } = require('../../config');

const SESSION_COOKIE = 'csj_session',
	MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Cookie options shared between the API and dashboard
function cookieOptions(maxAge, path = '/') {
	return {
		httpOnly: true,
		secure: (API.publicURL ?? '').startsWith('https://'),
		sameSite: 'lax',
		path,
		domain: API.cookieDomain || undefined,
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
