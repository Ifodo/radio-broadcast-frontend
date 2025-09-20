// Vercel Serverless Function: Proxy to RBS events/by-type to avoid CORS

module.exports = async (req, res) => {
	if (req.method === 'OPTIONS') {
		res.statusCode = 204;
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		return res.end();
	}

	const { type, limit, order } = req.query || {};
	const qs = new URLSearchParams();
	if (type) qs.set('type', String(type));
	if (limit) qs.set('limit', String(limit));
	if (order) qs.set('order', String(order));
	const upstream = `https://rbs.elektranbroadcast.com/events/by-type?${qs.toString()}`;

	try {
		const upstreamResp = await fetch(upstream, { method: 'GET' });
		const text = await upstreamResp.text();
		res.statusCode = upstreamResp.status;
		res.setHeader('Content-Type', upstreamResp.headers.get('content-type') || 'application/json');
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Access-Control-Allow-Origin', '*');
		return res.end(text);
	} catch (err) {
		res.statusCode = 502;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify({ error: 'Bad Gateway', detail: String(err && err.message || err) }));
	}
};


