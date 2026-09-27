// Dependencies
const express = require('express'),
	{ PermissionFlagsBits } = require('discord.js'),
	{ userSchema, SessionSchema } = require('../../database/models'),
	{ fetchUserGuilds } = require('../lib/discord'),
	{ wrap, isOwner, requireSession, rateLimit } = require('../lib/middleware');

const MANAGE = PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator,
	MAX_RANK_IMAGE = 2 * 1024 * 1024;

// Check magic bytes, the content-type header alone can't be trusted
function imageType(buffer) {
	if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
	if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
	return null;
}

module.exports = (bot) => {
	const router = express.Router(),
		guildCache = new Map(),
		limiter = rateLimit({ windowMs: 60 * 1000, max: 30, key: (req) => req.session.userID });

	router.use(requireSession);

	router.get('/', wrap(async (req, res) => {
		const settings = await userSchema.findOne({ userID: req.session.userID });
		res.json({
			user: req.session.user,
			isOwner: isOwner(bot, req.session.userID),
			settings: {
				Language: settings?.Language ?? 'en-US',
				premium: settings?.premium ?? false,
				premiumSince: settings?.premiumSince ?? null,
				hasRankImage: Boolean(settings?.rankImage?.length),
			},
			languages: [...bot.translations.keys()],
		});
	}));

	router.patch('/settings', limiter, wrap(async (req, res) => {
		const { Language } = req.body ?? {};
		if (!bot.translations.has(Language)) return res.status(400).json({ error: 'Language is not a valid option' });
		await userSchema.findOneAndUpdate({ userID: req.session.userID }, { Language }, { upsert: true });
		res.json({ success: true, settings: { Language } });
	}));

	// Servers the user can manage, and whether the bot is in them
	router.get('/guilds', wrap(async (req, res) => {
		const hit = guildCache.get(req.session.hash);
		if (hit && hit.expires > Date.now()) return res.json(hit.value);

		let guilds;
		try {
			guilds = await fetchUserGuilds(req.session.accessToken);
		} catch (err) {
			if (err.response?.status === 401) {
				await SessionSchema.deleteOne({ hash: req.session.hash });
				return res.status(401).json({ error: 'Your Discord login expired' });
			}
			if (err.response?.status === 429) return res.status(429).json({ error: 'Discord is rate limiting us, try again shortly' });
			throw err;
		}

		const owner = isOwner(bot, req.session.userID),
			seen = new Set(),
			list = [];

		for (const g of guilds) {
			if (!g.owner && (BigInt(g.permissions) & MANAGE) === 0n && !owner) continue;
			seen.add(g.id);
			const guild = bot.guilds.cache.get(g.id);
			list.push({
				id: g.id,
				name: g.name,
				icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
				botPresent: Boolean(guild),
				memberCount: guild?.memberCount ?? null,
			});
		}

		// Bot owners can manage every server the bot is in
		if (owner) {
			for (const guild of bot.guilds.cache.values()) {
				if (seen.has(guild.id)) continue;
				list.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), botPresent: true, memberCount: guild.memberCount });
			}
		}

		list.sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
		const value = { guilds: list };
		if (guildCache.size > 1000) {
			for (const [k, v] of guildCache) if (v.expires <= Date.now()) guildCache.delete(k);
		}
		guildCache.set(req.session.hash, { value, expires: Date.now() + 30 * 1000 });
		res.json(value);
	}));

	router.get('/rank-image', wrap(async (req, res) => {
		const settings = await userSchema.findOne({ userID: req.session.userID });
		if (!settings?.rankImage?.length) return res.status(404).json({ error: 'No rank image set' });
		res.type(imageType(settings.rankImage) ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(settings.rankImage);
	}));

	// Premium only: custom rank card background, sent as the raw image body
	router.put('/rank-image', limiter, express.raw({ type: ['image/png', 'image/jpeg'], limit: MAX_RANK_IMAGE }), wrap(async (req, res) => {
		const settings = await userSchema.findOne({ userID: req.session.userID });
		if (!settings?.premium) return res.status(403).json({ error: 'Custom rank cards are a premium feature' });
		if (!Buffer.isBuffer(req.body) || !imageType(req.body)) return res.status(400).json({ error: 'Upload a PNG or JPEG image under 2 MB' });

		await userSchema.findOneAndUpdate({ userID: req.session.userID }, { rankImage: req.body });
		const user = bot.users.cache.get(req.session.userID);
		if (user) user.rankImage = req.body;
		res.json({ success: true });
	}));

	router.delete('/rank-image', limiter, wrap(async (req, res) => {
		await userSchema.findOneAndUpdate({ userID: req.session.userID }, { $unset: { rankImage: 1 } });
		const user = bot.users.cache.get(req.session.userID);
		if (user) user.rankImage = '';
		res.json({ success: true });
	}));

	return router;
};
