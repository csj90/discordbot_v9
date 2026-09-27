const express = require('express'),
	{ API } = require('../config'),
	{ promisify } = require('util'),
	readdir = promisify(require('fs').readdir),
	{ requireInternalToken } = require('./lib/middleware');

// Routes that check their own per-guild API key instead of the internal token
const SELF_AUTHED = ['players'];

module.exports = async bot => {
	const app = express(),
		routes = (await readdir('./src/http/routes')).filter((v, i, a) => a.indexOf(v) === i),
		endpoints = [];

	app
		.disable('x-powered-by')
		.set('trust proxy', API.trustProxy ?? false);

	// Dashboard API (session cookies, CORS for the website)
	app.use('/v1', require('./v1')(bot));

	// Legacy server-to-server routes
	app.use(express.json());
	for (const route of routes) {
		if (route === 'index.js') continue;
		const name = route.replace('.js', ''),
			router = require(`./routes/${route}`)(bot);
		if (SELF_AUTHED.includes(name)) app.use(`/${name}`, router);
		else app.use(`/${name}`, requireInternalToken, router);
		endpoints.push(`${name}:`, ...(router.stack.map(item => `\t ${item.route.path}`).filter((v, i, a) => a.indexOf(v) === i && v !== '/')));
	}

	// Create web server
	app
		.get('/', (req, res) => {
			res
				.type('text/plain')
				.send([
					`API server for ${bot.user.tag}`,
					'Endpoints:',
					endpoints.join('\n'),
				].join('\n'));
		})
		// Make sure web scrapers aren't used
		.get('/robots.txt', function(req, res) {
			res
				.type('text/plain')
				.send('User-agent: *\ndisallow: /');
		})
		.get('*', async function(req, res) {
			res.send('No data here. Go away!');
		})
		// Run the server
		.listen(API.port, () => {
			bot.logger.ready(`Statistics API has loaded on port:${API.port}`);
		})
		.on('error', (err) => {
			bot.logger.error(`Error with starting HTTP API: ${err.message}`);
		});
};
