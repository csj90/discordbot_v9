// Dependencies
const express = require('express'),
	{ PermissionsBitField } = require('discord.js'),
	{ RankSchema } = require('../../database/models'),
	{ inviteURL } = require('../lib/discord'),
	{ wrap } = require('../lib/middleware');

// XP needed to reach the next level (see helpers/levelSystem.js)
const levelThreshold = (level) => (level <= 0 ? 0 : 5 * (level ** 2) + 50 * level + 100);

// Small in-memory cache so the website can't hammer the bot
function cached(ttl, fn) {
	const store = new Map();
	return async (key = '') => {
		const hit = store.get(key);
		if (hit && hit.expires > Date.now()) return hit.value;
		const value = await fn(key);
		store.set(key, { value, expires: Date.now() + ttl });
		return value;
	};
}

const sum = (values) => values.reduce((a, b) => a + b, 0);

module.exports = (bot) => {
	const router = express.Router();

	const getStats = cached(15 * 1000, async () => {
		// Totals across every shard
		const [guilds, members] = bot.shard
			? await Promise.all([
				bot.shard.fetchClientValues('guilds.cache.size').then(sum),
				bot.shard.broadcastEval((c) => c.guilds.cache.reduce((a, g) => a + g.memberCount, 0)).then(sum),
			])
			: [bot.guilds.cache.size, bot.guilds.cache.reduce((a, g) => a + g.memberCount, 0)];
		const memory = process.memoryUsage();

		return {
			guilds,
			members,
			commands: bot.commands.size,
			shards: bot.shard?.count ?? 1,
			ping: Math.round(bot.ws.ping),
			uptime: Math.round(process.uptime() * 1000),
			memory: { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, rss: memory.rss },
			commandsUsed: bot.commandsUsed,
			messagesSeen: bot.messagesSent,
			nodes: [...(bot.manager?.nodes?.values() ?? [])].map((node) => ({
				name: node.options.identifier ?? node.options.host,
				connected: node.connected,
				players: node.stats?.players ?? 0,
				playingPlayers: node.stats?.playingPlayers ?? 0,
				uptime: node.stats?.uptime ?? 0,
				cpuLoad: node.stats?.cpu?.lavalinkLoad ?? 0,
				memoryUsed: node.stats?.memory?.used ?? 0,
			})),
		};
	});

	const getCommands = cached(10 * 60 * 1000, async () => bot.commands
		.filter((c) => c.help.category !== 'Host' && !c.conf.ownerOnly)
		.map((c) => ({
			name: c.help.name,
			category: c.help.category,
			description: c.help.description,
			usage: c.help.usage,
			aliases: c.help.aliases ?? [],
			examples: c.help.examples ?? [],
			slash: Boolean(c.conf.slash),
			permissions: new PermissionsBitField(c.conf.userPermissions ?? []).toArray(),
		}))
		.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));

	const getLeaderboard = cached(60 * 1000, async (guildId) => {
		const guild = bot.guilds.cache.get(guildId);
		const ranks = await RankSchema.find({ guildID: guildId }).sort({ Xp: -1 }).limit(100).lean();

		return {
			guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount },
			members: ranks.map((r, i) => {
				const user = guild.members.cache.get(r.userID)?.user ?? bot.users.cache.get(r.userID);
				return {
					rank: i + 1,
					id: r.userID,
					username: user?.globalName ?? user?.username ?? 'Unknown user',
					avatar: user?.displayAvatarURL({ size: 64 }) ?? null,
					level: r.Level,
					xp: r.Xp,
					currentLevelXp: levelThreshold(r.Level - 1),
					nextLevelXp: levelThreshold(r.Level),
				};
			}),
		};
	});

	router.get('/meta', (req, res) => {
		res.json({
			id: bot.user.id,
			username: bot.user.username,
			avatar: bot.user.displayAvatarURL({ size: 256 }),
			inviteURL: inviteURL(bot),
			supportServer: bot.config.SupportServer?.link ?? null,
		});
	});

	router.get('/stats', wrap(async (req, res) => res.json(await getStats())));

	router.get('/commands', wrap(async (req, res) => res.json({ commands: await getCommands() })));

	router.get('/leaderboard/:guildId', wrap(async (req, res) => {
		const guild = bot.guilds.cache.get(req.params.guildId);
		if (!guild) return res.status(404).json({ error: 'Server not found' });
		if (guild.settings?.LevelPublicBoard === false) {
			return res.status(403).json({ error: 'This server has not made its leaderboard public' });
		}
		res.json(await getLeaderboard(guild.id));
	}));

	return router;
};
