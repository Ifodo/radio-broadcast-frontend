// Configuration
const onVercel = typeof window !== 'undefined' && /vercel\.app$/i.test(location.hostname);
const BASE_URL = onVercel ? '' : 'https://rbs.elektranbroadcast.com';

// Minimal state
const state = {
	filters: {
		type: 'SONG',
		limit: 50,
		order: 'desc',
	},
	events: [],
	page: 1,
	pageSize: 25,
	sort: { key: 'play_time', dir: 'desc' },
	nowOnAir: null,
	lastNowOnAirAt: null,
	connection: 'offline',
};

// DOM refs
const $ = (sel) => document.querySelector(sel);
const noaCardEl = $('#noa-card');
const noaUpdatedEl = $('#noa-updated');
const noaProgressEl = $('#noa-progress');
const noaRowEl = document.getElementById('noa-row');
const eventsTbodyEl = $('#events-tbody');
const eventsEmptyEl = $('#events-empty');
const connectionDotEl = $('#connection-dot');
const connectionTextEl = $('#connection-text');

// API helper
const api = async (path, options = {}) => {
    const url = `${BASE_URL}${(onVercel ? `/api${path}` : path)}`;
    const method = options.method || 'GET';
    const hasBody = options.body !== undefined && options.body !== null;
    const headers = { ...(options.headers || {}) };
    if (hasBody) headers['Content-Type'] = 'application/json';
    const resp = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
    });
	if (!resp.ok) {
		const text = await resp.text().catch(() => '');
		throw new Error(`HTTP ${resp.status} ${resp.statusText} - ${text}`);
	}
	const contentType = resp.headers.get('content-type') || '';
	if (contentType.includes('application/json')) return resp.json();
	return resp.text();
};

// Rendering
const setConnection = (status) => {
	state.connection = status;
	connectionTextEl.textContent = status;
	connectionDotEl.className = `h-2 w-2 rounded-full ${
		status === 'connected' ? 'bg-emerald-500' : status === 'reconnecting' ? 'bg-amber-400' : 'bg-slate-400'
	}`;
};

const fmtTime = (s) => {
	if (!s) return '';
	try {
		const d = new Date(s);
		if (Number.isNaN(d.getTime())) return String(s);
		return d.toLocaleString();
	} catch {
		return String(s);
	}
};

const renderNowOnAir = () => {
	const item = state.nowOnAir;
	noaUpdatedEl.textContent = state.lastNowOnAirAt ? fmtTime(state.lastNowOnAirAt) : '—';
	if (!item) {
		noaCardEl.innerHTML = `<div class="text-sm text-slate-400">No data</div>`;
		noaProgressEl.style.width = '0%';
        if (noaRowEl) noaRowEl.innerHTML = '';
		return;
	}
	const artist = item.artist ?? '';
	const title = item.title ?? '';
	const eventType = item.event_type ?? '';
	const playTime = item.play_time ?? '';
	noaCardEl.innerHTML = `
		<div class="space-y-1">
			<div class="noa-title">${title || '(untitled)'}</div>
			<div class="text-slate-300">${artist || ''}</div>
			<div class="noa-meta">${eventType} • ${fmtTime(playTime)}</div>
		</div>
	`;
	// Progress unknown from API; keep at 0 for now
	noaProgressEl.style.width = '0%';

    if (noaRowEl) {
        const cells = [
            `<div class="noa-label">NOW ON AIR</div>`,
            `<div><span class="noa-chip">${eventType || ''}</span></div>`,
            `<div>${artist || ''}</div>`,
            `<div class="truncate">${title || '(untitled)'}<span class="text-slate-400"> • ${fmtTime(playTime)}</span></div>`,
            `<div>${item.filename ?? ''}</div>`,
        ];
        noaRowEl.innerHTML = `<div class="noa-wrap">${cells.join('')}</div>`;
    }
};

const renderEvents = () => {
	const total = state.events.length;
	const totalEl = document.getElementById('events-total');
	if (totalEl) totalEl.textContent = String(total);

	if (!state.events || total === 0) {
		eventsTbodyEl.innerHTML = '';
		eventsEmptyEl.classList.remove('hidden');
		return;
	}
	eventsEmptyEl.classList.add('hidden');
	const start = (state.page - 1) * state.pageSize;
	const end = Math.min(start + state.pageSize, total);
	let working = state.events.slice();
	const { key, dir } = state.sort || {};
	working.sort((a, b) => {
		const av = (a?.[key] ?? '').toString();
		const bv = (b?.[key] ?? '').toString();
		if (key === 'play_time') {
			const ad = new Date(av).getTime() || 0;
			const bd = new Date(bv).getTime() || 0;
			return dir === 'asc' ? ad - bd : bd - ad;
		}
		return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});
	const pageItems = working.slice(start, end);
	const rows = pageItems.map((e) => {
		const tds = [
			`<td>${fmtTime(e.play_time)}</td>`,
			`<td>${e.event_type ?? ''}</td>`,
			`<td>${e.artist ?? ''}</td>`,
			`<td>${e.title ?? ''}</td>`,
			`<td>${e.filename ?? ''}</td>`,
		];
		return `<tr>${tds.join('')}</tr>`;
	});
	eventsTbodyEl.innerHTML = rows.join('');

	const pageInfo = document.getElementById('page-info');
	if (pageInfo) {
		const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
		pageInfo.textContent = `${state.page} / ${totalPages}`;
	}
};

// Data loaders
const fetchNowOnAir = async () => {
	try {
		const data = await api('/now-on-air');
		state.nowOnAir = data || null;
		state.lastNowOnAirAt = new Date().toISOString();
		renderNowOnAir();
		setConnection('connected');
	} catch (err) {
		console.error('now-on-air error', err);
		setConnection('reconnecting');
	}
};

const fetchEventsByType = async () => {
	const { type, limit, order } = state.filters;
	const qs = new URLSearchParams({ type, limit: String(limit), order });
	try {
		const data = await api(`/events/by-type?${qs.toString()}`);
		state.events = Array.isArray(data) ? data : (data?.items || data || []);
		renderEvents();
		setConnection('connected');
	} catch (err) {
		console.error('events error', err);
		setConnection('reconnecting');
	}
};

// Polling
let noaTimer = null;
let eventsTimer = null;

const startPolling = () => {
	clearInterval(noaTimer);
	clearInterval(eventsTimer);
	fetchNowOnAir();
	fetchEventsByType();
	noaTimer = setInterval(fetchNowOnAir, 3000);
	eventsTimer = setInterval(fetchEventsByType, 7000);
};

// UI handlers
const applyFilters = () => {
	const typeSel = /** @type {HTMLSelectElement} */ (document.getElementById('filter-type'));
	const limitInput = /** @type {HTMLInputElement} */ (document.getElementById('filter-limit'));
	const orderSel = /** @type {HTMLSelectElement} */ (document.getElementById('filter-order'));
	state.filters.type = typeSel.value;
	state.filters.limit = Math.max(1, Math.min(500, Number(limitInput.value) || 50));
	state.filters.order = orderSel.value;
	state.page = 1;
	fetchEventsByType();
};

const exportCsv = () => {
	const rows = [
		['time', 'type', 'artist', 'title', 'filename'],
		...state.events.map((e) => [
			String(e.play_time || ''),
			String(e.event_type || ''),
			String(e.artist || ''),
			String(e.title || ''),
			String(e.filename || ''),
		]),
	];
	const csv = rows.map((r) => r.map((v) => {
		const s = String(v);
		if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
		return s;
	}).join(',')).join('\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `events_${state.filters.type.toLowerCase()}_${Date.now()}.csv`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
};

// Wire events
document.getElementById('apply-filters').addEventListener('click', applyFilters);
document.getElementById('export-csv').addEventListener('click', exportCsv);
document.getElementById('refresh-btn').addEventListener('click', () => {
	fetchNowOnAir();
	fetchEventsByType();
});

const pageSizeSel = /** @type {HTMLSelectElement} */ (document.getElementById('page-size'));
if (pageSizeSel) {
	pageSizeSel.addEventListener('change', () => {
		state.pageSize = Math.max(1, Number(pageSizeSel.value) || 25);
		state.page = 1;
		renderEvents();
	});
}
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');
if (prevBtn && nextBtn) {
	prevBtn.addEventListener('click', () => {
		const totalPages = Math.max(1, Math.ceil((state.events?.length || 0) / state.pageSize));
		state.page = Math.max(1, state.page - 1);
		renderEvents();
	});
	nextBtn.addEventListener('click', () => {
		const totalPages = Math.max(1, Math.ceil((state.events?.length || 0) / state.pageSize));
		state.page = Math.min(totalPages, state.page + 1);
		renderEvents();
	});
}

// Sorting handlers
const setSortIndicator = () => {
	const indicators = document.querySelectorAll('.sort-indicator');
	indicators.forEach((el) => {
		const key = el.getAttribute('data-key');
		el.removeAttribute('data-dir');
		if (key === state.sort.key) el.setAttribute('data-dir', state.sort.dir);
	});
};

document.querySelectorAll('.th-sortable').forEach((th) => {
	th.addEventListener('click', () => {
		const key = th.getAttribute('data-sort-key');
		if (!key) return;
		if (state.sort.key === key) {
			state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
		} else {
			state.sort.key = key;
			state.sort.dir = 'asc';
		}
		state.page = 1;
		setSortIndicator();
		renderEvents();
	});
});

// Collapse/expand NOA card
const toggleBtn = document.getElementById('toggle-noa');
if (toggleBtn) {
	toggleBtn.addEventListener('click', () => {
		const card = document.getElementById('noa-card');
		const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
		if (expanded) {
			card.style.display = 'none';
			toggleBtn.textContent = 'Show';
			toggleBtn.setAttribute('aria-expanded', 'false');
		} else {
			card.style.display = '';
			toggleBtn.textContent = 'Hide';
			toggleBtn.setAttribute('aria-expanded', 'true');
		}
	});
}

// Init
setConnection('offline');
startPolling();


