// Vercel Serverless Function: Proxy to RBS now-on-air to avoid CORS
const UPSTREAM = 'https://rbs.elektranbroadcast.com/now-on-air';

module.exports = async (req, res) => {
	if (req.method === 'OPTIONS') {
		res.statusCode = 204;
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		return res.end();
	}

	try {
		const upstreamResp = await fetch(UPSTREAM, { method: 'GET' });
		const text = await upstreamResp.text();
		res.statusCode = upstreamResp.status;
		res.setHeader('Content-Type', upstreamResp.headers.get('content-type') || 'application/json');
		res.setHeader('Cache-Control', 'no-store');
		// Same-origin on Vercel, but allow wide for safety
		res.setHeader('Access-Control-Allow-Origin', '*');
		return res.end(text);
	} catch (err) {
		res.statusCode = 502;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify({ error: 'Bad Gateway', detail: String(err && err.message || err) }));
	}
};


