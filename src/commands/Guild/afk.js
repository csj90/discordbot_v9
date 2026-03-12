const Command = require('../../structures/Command.js');
const Afk = require('../../database/models/Afk.js');
const { PermissionFlagsBits } = require('discord.js');

module.exports = class AfkCommand extends Command {
	constructor(bot) {
		super(bot, {
			name: 'afk',
			guildOnly: true,
			dirname: __dirname,
			aliases: ['away', 'brb'],
			description: 'Set your AFK status and update your nickname.',
			usage: 'afk [reason]',
			cooldown: 2000,
			examples: ['afk', 'afk eating dinner'],
			slash: true,
			options: [
				{
					name: 'reason',
					description: 'Reason for going AFK',
					type: 3,
					required: false
				}
			],
		});
	}

	// Prefix command
	async run(bot, message, settings) {

		if (!message.guild) return;

		const reason = message.content.split(' ').slice(1).join(' ') || 'AFK';
		const member = message.member;

		if (!member) return;

		const originalNick = member.displayName;

		await Afk.findOneAndUpdate(
			{ userID: member.id, guildID: message.guild.id },
			{ reason: reason, time: Date.now(), originalNick: originalNick },
			{ upsert: true, new: true }
		);

		const botMember = message.guild.members.me;

		if (
			botMember &&
			botMember.permissions.has(PermissionFlagsBits.ManageNicknames) &&
			member.manageable &&
			member.id !== message.guild.ownerId
		) {
			try {

				if (!originalNick.startsWith('[AFK]')) {
					await member.setNickname(`[AFK] ${originalNick}`);
				}

			} catch (err) {
				console.log(`Failed to set AFK nickname for ${member.user.tag}: ${err.message}`);
			}
		}

		return message.reply(`😴 You are now AFK: **${reason}**`);
	}

	// Slash command
	async callback(bot, interaction, guild) {

		const reason = interaction.options.getString('reason') || 'AFK';

		let member;

		try {
			member = await guild.members.fetch(interaction.user.id);
		} catch {
			return interaction.reply({ content: 'Failed to fetch member.', ephemeral: true });
		}

		const originalNick = member.displayName;

		await Afk.findOneAndUpdate(
			{ userID: interaction.user.id, guildID: guild.id },
			{ reason: reason, time: Date.now(), originalNick: originalNick },
			{ upsert: true, new: true }
		);

		const botMember = guild.members.me;

		if (
			botMember &&
			botMember.permissions.has(PermissionFlagsBits.ManageNicknames) &&
			member.manageable &&
			member.id !== guild.ownerId
		) {
			try {

				if (!originalNick.startsWith('[AFK]')) {
					await member.setNickname(`[AFK] ${originalNick}`);
				}

			} catch (err) {
				console.log(`Failed to set AFK nickname for ${member.user.tag}: ${err.message}`);
			}
		}

		return interaction.reply({
			content: `😴 You are now AFK: **${reason}**`,
			ephemeral: false
		});
	}
};
