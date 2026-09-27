// Dependencies
const axios = require('axios'),
	{ API } = require('../../config');

const DISCORD_API = 'https://discord.com/api/v10';

const clientID = (bot) => bot.application?.id ?? bot.user.id;
const redirectURI = () => `${API.publicURL}/v1/auth/callback`;

function authorizeURL(bot, state) {
	const params = new URLSearchParams({
		client_id: clientID(bot),
		redirect_uri: redirectURI(),
		response_type: 'code',
		scope: 'identify guilds',
		prompt: 'none',
		state,
	});
	return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(bot, code) {
	const { data } = await axios.post(`${DISCORD_API}/oauth2/token`, new URLSearchParams({
		client_id: clientID(bot),
		client_secret: API.clientSecret,
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectURI(),
	}), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
	return data;
}

async function fetchUser(accessToken) {
	const { data } = await axios.get(`${DISCORD_API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	return data;
}

async function fetchUserGuilds(accessToken) {
	const { data } = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	return data;
}

function inviteURL(bot, guildID) {
	const params = new URLSearchParams({
		client_id: clientID(bot),
		scope: 'bot applications.commands',
		permissions: '1073081686',
	});
	if (guildID) {
		params.set('guild_id', guildID);
		params.set('disable_guild_select', 'true');
	}
	return `https://discord.com/oauth2/authorize?${params}`;
}

module.exports = { authorizeURL, exchangeCode, fetchUser, fetchUserGuilds, inviteURL };
