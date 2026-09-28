const { Schema, model } = require('mongoose');

const sessionSchema = Schema({
	// sha256 of the session ID stored in the user's cookie
	hash: { type: String, required: true, unique: true },
	userID: { type: String, required: true },
	// Discord OAuth2 access token (identify + guilds scopes)
	accessToken: { type: String, required: true },
	user: {
		id: String,
		username: String,
		globalName: String,
		avatar: String,
	},
	expiresAt: { type: Date, required: true },
});

// Let MongoDB remove expired sessions
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Own collection: "sessions" already exists in some databases (NextAuth) with a unique sessionToken index
module.exports = model('DashboardSession', sessionSchema, 'dashboard_sessions');
