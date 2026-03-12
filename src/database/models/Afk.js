const mongoose = require('mongoose');

const AfkSchema = new mongoose.Schema({
    userID: { type: String, required: true },
    guildID: { type: String, required: true },
    reason: { type: String, default: 'AFK' },
    time: { type: Number, default: Date.now },
    originalNick: { type: String, default: null } // <-- store original nickname
});

module.exports = mongoose.model('Afk', AfkSchema);
