// Dependencies
const { Embed } = require('../../utils');
const { ApplicationCommandOptionType, PermissionsBitField: { Flags } } = require('discord.js');
const axios = require('axios');
const Command = require('../../structures/Command.js');

const rfc3986EncodeURIComponent = (str) =>
	encodeURIComponent(str).replace(/[!'()*]/g, escape);

class Play extends Command {

	constructor(bot) {
		super(bot, {
			name: 'play',
			guildOnly: true,
			dirname: __dirname,
			aliases: ['p'],
			botPermissions: [Flags.SendMessages, Flags.EmbedLinks, Flags.Connect, Flags.Speak],
			description: 'Play a song.',
			usage: 'play <song name / link>',
			cooldown: 3000,
			examples: ['play palaye royale', 'play https://youtube.com/...'],
			slash: true,
			options: [
				{
					name: 'track',
					description: 'Song name or URL',
					type: ApplicationCommandOptionType.String,
					required: true,
					autocomplete: true,
				},
				{
					name: 'flag',
					description: '(R)everse, (S)huffle or (N)ext to queue',
					type: ApplicationCommandOptionType.String,
					choices: ['-r', '-n', '-s'].map(i => ({ name: i, value: i })),
				}
			]
		});
	}

	/* MESSAGE COMMAND */

	async run(bot, message, settings) {

		if (!message.member.voice.channel)
			return message.channel.error('music/play:NOT_VC');

		const playerCheck = bot.manager.players.get(message.guild.id);

		if (playerCheck) {
			if (message.member.voice.channel.id !== playerCheck.voiceChannelId)
				return message.channel.error('misc:NOT_VOICE');
		}

		let player;

		try {
			player = bot.manager.create({
				guildId: message.guild.id,
				voiceChannelId: message.member.voice.channel.id,
				textChannelId: message.channel.id,
				volume: 75,
				selfDeafen: true
			});
		} catch {
			return message.channel.error('misc:ERROR_MESSAGE');
		}

		const search = message.args.join(" ");

		if (!search)
			return message.channel.error('music/play:NO_INPUT');

		let res;

		try {
			res = await player.search(search, message.author);

			if (res.loadType === 'error') {
				if (!player.queue.current) player.destroy();
				throw res.exception;
			}

		} catch (err) {
			return message.channel.error('music/play:ERROR', { ERROR: err.message });
		}

		if (res.loadType === 'empty') {
			if (!player.queue.current) player.destroy();
			return message.channel.error('music/play:NO_SONG');
		}

		if (player.state !== "CONNECTED")
			player.connect();

		if (res.loadType === "playlist") {

			player.queue.add(res.playlist.tracks);

			if (!player.playing && !player.paused)
				player.play();

			const embed = new Embed(bot, message.guild)
				.setColor(message.member.displayHexColor)
				.setDescription(
					message.translate("music/play:QUEUED", {
						NUM: res.playlist.tracks.length
					})
				);

			return message.channel.send({ embeds: [embed] });

		} else {

			const track = res.tracks[0];

			player.queue.add(track);

			if (!player.playing && !player.paused) {
				player.play();
				return;
			}

			const embed = new Embed(bot, message.guild)
				.setColor(message.member.displayHexColor)
				.setDescription(
					message.translate("music/play:SONG_ADD", {
						TITLE: track.title,
						URL: track.uri
					})
				);

			return message.channel.send({ embeds: [embed] });
		}
	}

	/* SLASH COMMAND */

	async callback(bot, interaction, guild, args) {

		const channel = guild.channels.cache.get(interaction.channelId);
		const member = guild.members.cache.get(interaction.user.id);

		const flag = args.get('flag')?.value;
		const search = args.get('track').value;

		if (!member.voice.channel)
			return interaction.reply({
				ephemeral: true,
				embeds: [channel.error('music/play:NOT_VC', null, true)]
			});

		await interaction.deferReply();

		let player;

		try {
			player = bot.manager.create({
				guildId: guild.id,
				voiceChannelId: member.voice.channel.id,
				textChannelId: channel.id,
				volume: 75,
				selfDeafen: true
			});
		} catch {
			return interaction.followUp({
				ephemeral: true,
				embeds: [channel.error('misc:ERROR_MESSAGE', null, true)]
			});
		}

		let res;

		try {

			res = await player.search(search, member);

			if (res.loadType === "error") {
				if (!player.queue.current) player.destroy();
				throw res.exception;
			}

		} catch (err) {

			return interaction.followUp({
				ephemeral: true,
				embeds: [channel.error('music/play:ERROR', { ERROR: err.message }, true)]
			});
		}

		if (res.loadType === "empty") {
			if (!player.queue.current) player.destroy();

			return interaction.followUp({
				ephemeral: true,
				embeds: [channel.error('music/play:NO_SONG', null, true)]
			});
		}

		if (player.state !== "CONNECTED")
			player.connect();

		if (res.loadType === "playlist") {

			let tracks = res.playlist.tracks;

			if (flag === "-r")
				tracks = tracks.reverse();

			if (flag === "-s")
				tracks = tracks.sort(() => Math.random() - 0.5);

			if (flag === "-n")
				player.queue.unshift(...tracks);
			else
				player.queue.add(tracks);

			if (!player.playing && !player.paused)
				player.play();

			return interaction.followUp({
				embeds: [
					new Embed(bot, guild)
						.setColor(member.displayHexColor)
						.setDescription(
							bot.translate("music/play:QUEUED", {
								NUM: tracks.length
							})
						)
				]
			});

		} else {

			const track = res.tracks[0];

			if (flag === "-n")
				player.queue.unshift(track);
			else
				player.queue.add(track);

			if (!player.playing && !player.paused) {
				player.play();

				return interaction.followUp({
					embeds: [channel.success('music/play:QUEUE', {}, true)]
				});
			}

			const embed = new Embed(bot, guild)
				.setColor(member.displayHexColor)
				.setDescription(
					bot.translate('music/play:SONG_ADD', {
						TITLE: track.title,
						URL: track.uri
					})
				);

			return interaction.followUp({ embeds: [embed] });
		}
	}

}

module.exports = Play;
