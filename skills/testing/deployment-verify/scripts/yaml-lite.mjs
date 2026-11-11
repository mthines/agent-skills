// A YAML subset parser for .agents/aw/release.yml, so the controller runs with no dependencies.
// Supports: block maps, block lists (including "- key: value" items), flow maps and lists,
// single- and double-quoted strings, numbers, booleans, null, and # comments.
// Anything else (anchors, tags, multi-line strings, documents) throws with the line number.

export function parseYaml(text) {
	const lines = [];
	text.split("\n").forEach((raw, i) => {
		const line = stripComment(raw).replace(/\s+$/, "");
		if (line.trim() === "" || line.trim() === "---") return;
		if (/^\s*[&*!|>]/.test(line.replace(/^\s*-\s*/, "").replace(/^[^:]*:\s*/, ""))) {
			throw new Error(`yaml-lite: unsupported syntax on line ${i + 1}: ${raw.trim()}`);
		}
		lines.push({ indent: line.length - line.trimStart().length, text: line.trim(), no: i + 1 });
	});
	if (!lines.length) return {};
	const [value, next] = parseBlock(lines, 0, lines[0].indent);
	if (next !== lines.length) throw new Error(`yaml-lite: unexpected indentation on line ${lines[next].no}`);
	return value;
}

function stripComment(raw) {
	let quote = null;
	for (let i = 0; i < raw.length; i++) {
		const c = raw[i];
		if (quote) {
			if (c === quote) quote = null;
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
			return raw.slice(0, i);
		}
	}
	return raw;
}

function parseBlock(lines, start, indent) {
	return lines[start].text.startsWith("- ") || lines[start].text === "-"
		? parseList(lines, start, indent)
		: parseMap(lines, start, indent);
}

function parseMap(lines, start, indent) {
	const out = {};
	let i = start;
	while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
		const { key, rest } = splitKey(lines[i]);
		i++;
		if (rest !== "") {
			out[key] = parseInline(rest, lines[i - 1].no);
		} else if (i < lines.length && lines[i].indent > indent) {
			[out[key], i] = parseBlock(lines, i, lines[i].indent);
		} else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
			[out[key], i] = parseList(lines, i, indent);
		} else {
			out[key] = null;
		}
	}
	return [out, i];
}

function parseList(lines, start, indent) {
	const out = [];
	let i = start;
	while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
		const body = lines[i].text === "-" ? "" : lines[i].text.slice(2).trim();
		const no = lines[i].no;
		i++;
		if (body === "") {
			if (i < lines.length && lines[i].indent > indent) [out[out.length], i] = parseBlock(lines, i, lines[i].indent);
			else out.push(null);
		} else if (/^[^"'{\[][^:]*:(\s|$)/.test(body)) {
			// "- key: value" starts a map whose further keys sit at indent + 2.
			const itemIndent = indent + 2;
			const synthetic = [{ indent: itemIndent, text: body, no }];
			while (i < lines.length && lines[i].indent >= itemIndent) synthetic.push(lines[i++]);
			const [map, used] = parseMap(rebase(synthetic), 0, 0);
			if (used !== synthetic.length) throw new Error(`yaml-lite: unexpected indentation on line ${synthetic[used].no}`);
			out.push(map);
		} else {
			out.push(parseInline(body, no));
		}
	}
	return [out, i];
}

function rebase(lines) {
	const base = lines[0].indent;
	return lines.map((l) => ({ ...l, indent: l.indent - base }));
}

function splitKey(line) {
	const m = line.text.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(\s+(.*))?$/);
	if (!m) throw new Error(`yaml-lite: expected "key: value" on line ${line.no}: ${line.text}`);
	return { key: unquote(m[1]), rest: (m[3] ?? "").trim() };
}

function unquote(s) {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
	return s;
}

function parseInline(text, no) {
	const p = { s: text, i: 0, no };
	const v = flowValue(p);
	skipWs(p);
	if (p.i !== p.s.length) throw new Error(`yaml-lite: trailing text on line ${no}: ${text}`);
	return v;
}

function skipWs(p) {
	while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
}

function flowValue(p) {
	skipWs(p);
	const c = p.s[p.i];
	if (c === "{") return flowMap(p);
	if (c === "[") return flowList(p);
	if (c === '"' || c === "'") {
		const end = p.s.indexOf(c, p.i + 1);
		if (end < 0) throw new Error(`yaml-lite: unterminated string on line ${p.no}`);
		const v = p.s.slice(p.i + 1, end);
		p.i = end + 1;
		return v;
	}
	const m = p.s.slice(p.i).match(/^[^,\]}]*/);
	p.i += m[0].length;
	return scalar(m[0].trim());
}

function flowMap(p) {
	const out = {};
	p.i++;
	for (;;) {
		skipWs(p);
		if (p.s[p.i] === "}") return p.i++, out;
		const km = p.s.slice(p.i).match(/^("[^"]*"|'[^']*'|[^:,}]+?)\s*:\s*/);
		if (!km) throw new Error(`yaml-lite: bad flow map on line ${p.no}`);
		p.i += km[0].length;
		out[unquote(km[1].trim())] = flowValue(p);
		skipWs(p);
		if (p.s[p.i] === ",") p.i++;
		else if (p.s[p.i] !== "}") throw new Error(`yaml-lite: expected , or } on line ${p.no}`);
	}
}

function flowList(p) {
	const out = [];
	p.i++;
	for (;;) {
		skipWs(p);
		if (p.s[p.i] === "]") return p.i++, out;
		out.push(flowValue(p));
		skipWs(p);
		if (p.s[p.i] === ",") p.i++;
		else if (p.s[p.i] !== "]") throw new Error(`yaml-lite: expected , or ] on line ${p.no}`);
	}
}

function scalar(s) {
	if (s === "" || s === "~" || s === "null") return null;
	if (s === "true") return true;
	if (s === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
	return s;
}
