// Dependencies
const { ChannelType } = require('discord.js'),
	{ GuildSchema } = require('../../database/models'),
	logEvents = require('../../assets/json/logEvents.json');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

class ValidationError extends Error {
	constructor(key, reason) {
		super(`${key} ${reason}`);
		this.status = 400;
	}
}

// Validators return the cleaned value or throw a ValidationError
const bool = () => (v, key) => {
	if (typeof v !== 'boolean') throw new ValidationError(key, 'must be true or false');
	return v;
};

const text = (min, max) => (v, key) => {
	if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new ValidationError(key, `must be ${min}-${max} characters`);
	return v;
};

const number = (min, max, integer = false) => (v, key) => {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
		throw new ValidationError(key, `must be a${integer ? 'n integer' : ' number'} between ${min} and ${max}`);
	}
	return v;
};

const oneOf = (values) => (v, key, ctx) => {
	const allowed = typeof values === 'function' ? values(ctx) : values;
	if (!allowed.includes(v)) throw new ValidationError(key, 'is not a valid option');
	return v;
};

// Empty string or null clears the value
const nullable = (validator) => (v, key, ctx) => (v === null || v === '' ? null : validator(v, key, ctx));

const channel = (types) => (v, key, { guild }) => {
	const ch = typeof v === 'string' && guild.channels.cache.get(v);
	if (!ch || !types.includes(ch.type)) throw new ValidationError(key, 'is not a valid channel');
	return v;
};

const role = () => (v, key, { guild }) => {
	const r = typeof v === 'string' && guild.roles.cache.get(v);
	if (!r || r.id === guild.id || r.managed) throw new ValidationError(key, 'is not a valid role');
	return v;
};

const list = (item, max) => (v, key, ctx) => {
	if (!Array.isArray(v) || v.length > max) throw new ValidationError(key, `must be a list of up to ${max} items`);
	return [...new Set(v.map((i) => item(i, key, ctx)))];
};

// Every setting the dashboard can change
const FIELDS = {
	// General
	prefix: text(1, 5),
	Language: oneOf(({ bot }) => [...bot.translations.keys()]),
	plugins: list(oneOf(({ bot }) => pluginCategories(bot)), 20),
	// Welcome
	welcomePlugin: bool(),
	welcomeMessageToggle: bool(),
	welcomeMessageChannel: nullable(channel(TEXT_CHANNELS)),
	welcomeMessageText: text(1, 2000),
	welcomePrivateToggle: bool(),
	welcomePrivateText: text(1, 2000),
	welcomeRoleToggle: bool(),
	welcomeRoleGive: list(role(), 10),
	welcomeGoodbyeToggle: bool(),
	welcomeGoodbyeText: text(1, 2000),
	// Leveling
	LevelOption: oneOf([0, 1, 2]),
	LevelChannel: nullable(channel(TEXT_CHANNELS)),
	LevelMessage: text(1, 2000),
	LevelMultiplier: number(0.1, 10),
	LevelIgnoreRoles: list(role(), 25),
	LevelIgnoreChannel: list(channel(TEXT_CHANNELS), 25),
	LevelPublicBoard: bool(),
	// Logging
	ModLog: bool(),
	ModLogChannel: nullable(channel(TEXT_CHANNELS)),
	ModLogEvents: list(oneOf(logEvents), logEvents.length),
	ModLogIgnoreBot: bool(),
	// Moderation
	ModeratorRoles: list(role(), 25),
	ModerationWarningCounter: number(1, 20, true),
	ModerationClearToggle: bool(),
	ModerationIgnoreBotToggle: bool(),
	// Tickets
	TicketToggle: bool(),
	TicketSupportRole: nullable(role()),
	TicketCategory: nullable(channel([ChannelType.GuildCategory])),
	// Music
	MusicDJ: bool(),
	MusicDJRole: nullable(role()),
};

// Owner-only commands can't be toggled per server
const pluginCategories = (bot) => [...new Set(bot.commands.map((c) => c.help.category))].filter((c) => c !== 'Host').sort();

function validateSettings(body, ctx) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('body', 'must be an object');

	const updates = {};
	for (const [key, value] of Object.entries(body)) {
		if (!FIELDS[key]) throw new ValidationError(key, 'cannot be changed from the dashboard');
		updates[key] = FIELDS[key](value, key, ctx);
	}
	if (!Object.keys(updates).length) throw new ValidationError('body', 'has nothing to update');
	return updates;
}

// Only expose editable fields, with schema defaults filled in
const DEFAULTS = new GuildSchema().toObject();
function serializeSettings(settings) {
	const source = typeof settings?.toObject === 'function' ? settings.toObject() : settings ?? {};
	const out = {};
	for (const key of Object.keys(FIELDS)) out[key] = source[key] ?? DEFAULTS[key] ?? null;
	return out;
}

module.exports = { validateSettings, serializeSettings, pluginCategories, logEvents };
