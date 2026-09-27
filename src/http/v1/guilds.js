// Dependencies
const express = require('express'),
	{ ChannelType, PermissionFlagsBits } = require('discord.js'),
	{ validateSettings, serializeSettings, pluginCategories, logEvents } = require('../lib/settings'),
	{ wrap, requireSession, requireGuild, rateLimit } = require('../lib/middleware');

const GIVEAWAY_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions],
	MAX_GIVEAWAY_DURATION = 30 * 24 * 60 * 60 * 1000;

// Same messages the /g-start command uses
function giveawayMessages(guild) {
	return {
		giveaway: guild.translate('giveaway/g-start:TITLE'),
		giveawayEnded: guild.translate('giveaway/g-start:ENDED'),
		timeRemaining: guild.translate('giveaway/g-start:TIME_REMAINING'),
		inviteToParticipate: guild.translate('giveaway/g-start:INVITE_PARTICIPATE'),
		winMessage: guild.translate('giveaway/g-start:WIN_MESSAGE'),
		embedFooter: guild.translate('giveaway/g-start:FOOTER'),
		noWinner: guild.translate('giveaway/g-start:NO_WINNER'),
		winners: guild.translate('giveaway/g-start:WINNERS'),
		endedAt: guild.translate('giveaway/g-start:END_AT'),
		hostedBy: guild.translate('giveaway/g-start:HOSTED'),
		drawing: 'Drawing: {timestamp}',
		units: {
			seconds: guild.translate('time:SECONDS', { amount: '' }).trim(),
			minutes: guild.translate('time:MINUTES', { amount: '' }).trim(),
			hours: guild.translate('time:HOURS', { amount: '' }).trim(),
			days: guild.translate('time:DAYS', { amount: '' }).trim(),
		},
	};
}

function serializeGiveaway(g) {
	return {
		messageId: g.messageId,
		channelId: g.channelId,
		prize: g.prize,
		winnerCount: g.winnerCount,
		winnerIds: g.winnerIds,
		startAt: g.startAt,
		endAt: g.endAt === Infinity ? null : g.endAt,
		ended: g.ended,
		paused: Boolean(g.pauseOptions?.isPaused),
		messageURL: g.messageURL,
	};
}

function serializeTrack(track) {
	if (!track) return null;
	const requester = track.requester?.user ?? track.requester;
	return {
		title: track.title,
		author: track.author,
		uri: track.uri,
		thumbnail: track.artworkUrl ?? track.thumbnail ?? null,
		duration: track.duration,
		isStream: Boolean(track.isStream),
		requester: requester?.id ? { id: requester.id, username: requester.globalName ?? requester.username } : null,
	};
}

module.exports = (bot) => {
	const router = express.Router(),
		limiter = rateLimit({ windowMs: 60 * 1000, max: 60, key: (req) => req.session.userID });

	router.use(requireSession);
	router.param('guildId', requireGuild(bot));

	// Everything the dashboard needs to render a server
	router.get('/:guildId', (req, res) => {
		const { guild } = req;
		res.json({
			guild: {
				id: guild.id,
				name: guild.name,
				icon: guild.iconURL({ size: 128 }),
				memberCount: guild.memberCount,
			},
			settings: serializeSettings(guild.settings),
			channels: guild.channels.cache
				.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory, ChannelType.GuildVoice].includes(c.type))
				.sort((a, b) => a.rawPosition - b.rawPosition)
				.map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })),
			roles: guild.roles.cache
				.filter((r) => r.id !== guild.id && !r.managed)
				.sort((a, b) => b.position - a.position)
				.map((r) => ({ id: r.id, name: r.name, color: r.hexColor })),
			options: {
				languages: [...bot.translations.keys()],
				plugins: pluginCategories(bot),
				logEvents,
			},
		});
	});

	// Goes through updateGuild() so the bot's cached settings update immediately
	router.patch('/:guildId/settings', limiter, wrap(async (req, res) => {
		const updates = validateSettings(req.body, { bot, guild: req.guild });
		const settings = await req.guild.updateGuild(updates);
		bot.logger.log(`Dashboard: ${req.session.user.username} updated ${Object.keys(updates)} in [${req.guild.id}].`);
		res.json({ settings: serializeSettings(settings) });
	}));

	/* Giveaways */
	const findGiveaway = (req) => bot.giveawaysManager.giveaways.find((g) => g.messageId === req.params.messageId && g.guildId === req.guild.id);

	router.get('/:guildId/giveaways', (req, res) => {
		const giveaways = bot.giveawaysManager.giveaways
			.filter((g) => g.guildId === req.guild.id)
			.sort((a, b) => b.startAt - a.startAt)
			.map(serializeGiveaway);
		res.json({ giveaways });
	});

	router.post('/:guildId/giveaways', limiter, wrap(async (req, res) => {
		const { channelId, prize, winnerCount, duration } = req.body ?? {},
			channel = req.guild.channels.cache.get(channelId);

		if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return res.status(400).json({ error: 'Pick a text channel' });
		if (typeof prize !== 'string' || !prize.trim() || prize.length > 256) return res.status(400).json({ error: 'Prize must be 1-256 characters' });
		if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) return res.status(400).json({ error: 'Winners must be between 1 and 20' });
		if (!Number.isInteger(duration) || duration < 60 * 1000 || duration > MAX_GIVEAWAY_DURATION) return res.status(400).json({ error: 'Duration must be between 1 minute and 30 days' });
		if (!channel.permissionsFor(req.guild.members.me).has(GIVEAWAY_PERMS)) {
			return res.status(400).json({ error: `The bot needs View Channel, Send Messages, Embed Links and Add Reactions in #${channel.name}` });
		}

		const member = await req.guild.members.fetch(req.session.userID).catch(() => null);
		let giveaway;
		try {
			giveaway = await bot.giveawaysManager.start(channel, {
				duration,
				prize: prize.trim(),
				winnerCount,
				hostedBy: member ?? bot.user,
				messages: giveawayMessages(req.guild),
			});
		} catch (err) {
			return res.status(400).json({ error: typeof err === 'string' ? err : err.message });
		}
		bot.logger.log(`Dashboard: ${req.session.user.username} started a giveaway in server: [${req.guild.id}].`);
		res.status(201).json({ giveaway: serializeGiveaway(giveaway) });
	}));

	router.post('/:guildId/giveaways/:messageId/:action(end|pause|unpause|reroll)', limiter, wrap(async (req, res) => {
		const giveaway = findGiveaway(req);
		if (!giveaway) return res.status(404).json({ error: 'Giveaway not found' });

		try {
			await bot.giveawaysManager[req.params.action](giveaway.messageId);
		} catch (err) {
			return res.status(400).json({ error: typeof err === 'string' ? err : err.message });
		}
		res.json({ giveaway: serializeGiveaway(findGiveaway(req) ?? giveaway) });
	}));

	router.delete('/:guildId/giveaways/:messageId', limiter, wrap(async (req, res) => {
		const giveaway = findGiveaway(req);
		if (!giveaway) return res.status(404).json({ error: 'Giveaway not found' });
		await bot.giveawaysManager.delete(giveaway.messageId);
		res.json({ success: true });
	}));

	/* Music player */
	const getPlayer = (req) => bot.manager?.players.get(req.guild.id);

	function serializePlayer(player) {
		if (!player) return { player: null };
		const queue = [...player.queue];
		return {
			player: {
				playing: player.playing,
				paused: player.paused,
				volume: player.volume,
				position: player.position,
				voiceChannel: player.voiceChannel,
				textChannel: player.textChannel,
				current: serializeTrack(player.queue.current),
				queue: queue.slice(0, 50).map(serializeTrack),
				queueLength: queue.length,
				queueDuration: queue.reduce((a, t) => a + (t.duration ?? 0), 0),
			},
		};
	}

	router.get('/:guildId/player', (req, res) => res.json(serializePlayer(getPlayer(req))));

	router.post('/:guildId/player/:action(pause|resume|skip)', limiter, wrap(async (req, res) => {
		const player = getPlayer(req);
		if (!player?.queue.current) return res.status(404).json({ error: 'Nothing is playing' });

		if (req.params.action === 'pause') player.pause(true);
		else if (req.params.action === 'resume') player.pause(false);
		else player.stop();
		res.json(serializePlayer(player));
	}));

	router.put('/:guildId/player/volume', limiter, wrap(async (req, res) => {
		const player = getPlayer(req),
			{ volume } = req.body ?? {};
		if (!player) return res.status(404).json({ error: 'Nothing is playing' });
		if (!Number.isInteger(volume) || volume < 1 || volume > 1000) return res.status(400).json({ error: 'Volume must be between 1 and 1000' });
		player.setVolume(volume);
		res.json(serializePlayer(player));
	}));

	return router;
};
