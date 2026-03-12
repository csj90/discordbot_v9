const Command = require('../../structures/Command.js');
const axios = require('axios');
const { EmbedBuilder, Colors } = require('discord.js');
const config = require('../../config.js');

async function fetchStock(ticker) {
    const API_KEY = config.api_keys.alpha;
    if (!API_KEY) throw new Error('Alpha API key missing in config.js');

    const { data } = await axios.get(
        `https://www.alphavantage.co/query`,
        {
            params: {
                function: 'GLOBAL_QUOTE',
                symbol: ticker,
                apikey: API_KEY
            }
        }
    );

    const stock = data['Global Quote'];
    if (!stock || !stock['01. symbol']) {
        throw new Error('Stock not found or API limit reached.');
    }

    return {
        symbol: stock['01. symbol'],
        price: stock['05. price'],
        change: stock['09. change'],
        percent: stock['10. change percent'],
        open: stock['02. open'],
        high: stock['03. high'],
        low: stock['04. low'],
        volume: stock['06. volume']
    };
}

module.exports = class Stocks extends Command {
    constructor(bot) {
        super(bot, {
            name: 'stocks',
            aliases: ['stock', 'price', 'market'],
            dirname: __dirname,
            description: 'Pull live stock market data.',
            usage: 'stocks <TICKER>',
            examples: ['stocks AAPL', 'stocks TSLA'],
            cooldown: 5000,
            slash: true,
            options: [
                {
                    name: 'ticker',
                    description: 'Stock ticker symbol (Example: AAPL)',
                    type: 3,
                    required: true
                }
            ]
        });
    }

    buildEmbed(stock) {
        const color = parseFloat(stock.change) >= 0 ? Colors.Green : Colors.Red;

        return new EmbedBuilder()
            .setTitle(`📈 ${stock.symbol}`)
            .setColor(color)
            .addFields(
                { name: 'Price', value: `$${stock.price}`, inline: true },
                { name: 'Change', value: `${stock.change} (${stock.percent})`, inline: true },
                { name: 'Open', value: `$${stock.open}`, inline: true },
                { name: 'High', value: `$${stock.high}`, inline: true },
                { name: 'Low', value: `$${stock.low}`, inline: true },
                { name: 'Volume', value: stock.volume, inline: true }
            )
            .setFooter({ text: 'Data provided by Alpha Vantage' })
            .setTimestamp();
    }

    // ✅ PREFIX
    async run(bot, message) {
        const args = message.content.split(' ').slice(1);
        if (!args[0]) return message.reply('❌ Please provide a stock ticker.');

        try {
            const stock = await fetchStock(args[0].toUpperCase());
            const embed = this.buildEmbed(stock);
            return message.reply({ embeds: [embed] });
        } catch (err) {
            return message.reply(`❌ ${err.message}`);
        }
    }

    // ✅ SLASH
    async callback(bot, interaction) {
        const ticker = interaction.options.getString('ticker');

        try {
            const stock = await fetchStock(ticker.toUpperCase());
            const embed = this.buildEmbed(stock);
            return interaction.reply({ embeds: [embed] });
        } catch (err) {
            return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
        }
    }

    // ✅ HTTP
    async http(req, res) {
        const ticker = req.query.ticker;
        if (!ticker) return res.status(400).json({ error: 'Ticker query parameter required' });

        try {
            const stock = await fetchStock(ticker.toUpperCase());
            const embed = this.buildEmbed(stock);
            return res.json({
                success: true,
                data: stock,
                embed: embed.toJSON()
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};
