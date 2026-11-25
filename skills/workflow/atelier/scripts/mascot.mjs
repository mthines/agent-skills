#!/usr/bin/env node
// mascot.mjs — atelier's mascot: a painter in a beret, ink-on-paper sticker style, holding a small brush
// dipped in the mood's colour. card.mjs draws him on the status card; the SVGs are reusable on their own.
//
//   node mascot.mjs <outdir>   writes <mood>.svg for every mood
//   node mascot.mjs --self-test

import { mkdirSync, writeFileSync } from "node:fs";

import { isMain, makeTester } from "./lib.mjs";

const INK = "#111111";
const PAPER = "#ffffff";

const HEAD = "M62 146 C58 100 92 78 130 78 C176 78 204 108 202 152 C200 204 168 236 128 236 C88 236 64 204 62 146 Z";
const BERET = "M48 112 C34 82 86 44 146 46 C200 48 228 74 210 102 C196 116 156 106 124 108 C94 110 60 128 48 112 Z";
const EAR = "M200 142 C214 134 222 152 214 166 C210 174 202 172 199 168";

export const MOODS = {
	working: { accent: "#0969da", eyes: "dots", brows: "focus", mouth: "flat", extra: "" },
	ready: { accent: "#1a7f37", eyes: "smile", brows: "up", mouth: "smile", extra: "" },
	held: { accent: "#bf8700", eyes: "dots", brows: "raised", mouth: "hmm", extra: "question" },
	failed: { accent: "#cf222e", eyes: "dots", brows: "worried", mouth: "wavy", extra: "sweat" },
	refused: { accent: "#bc4c00", eyes: "dots", brows: "stern", mouth: "frown", extra: "" },
	shipped: { accent: "#1a7f37", eyes: "smile", brows: "up", mouth: "grin", extra: "sparkle" },
};

const EYES = {
	dots: `<ellipse cx="104" cy="146" rx="5.5" ry="7" fill="${INK}"/><ellipse cx="154" cy="146" rx="5.5" ry="7" fill="${INK}"/>`,
	smile: `<path d="M92 148 Q104 134 116 148 M142 148 Q154 134 166 148" class="line"/>`,
};
const BROWS = {
	focus: "M90 128 L116 126 M142 126 L168 128",
	up: "M90 124 Q103 116 116 122 M142 122 Q155 116 168 124",
	raised: "M90 130 L116 128 M142 116 Q156 108 170 118",
	worried: "M90 128 Q104 126 116 118 M142 118 Q154 126 168 128",
	stern: "M90 120 L116 132 M142 132 L168 120",
};
const MOUTHS = {
	flat: `<path d="M116 204 L140 204" class="line"/>`,
	smile: `<path d="M110 200 Q128 214 146 200" class="line"/>`,
	hmm: `<path d="M114 206 Q126 200 142 204" class="line"/>`,
	wavy: `<path d="M110 206 Q116 200 122 206 Q128 212 134 206 Q140 200 146 206" class="line"/>`,
	frown: `<path d="M110 210 Q128 196 146 210" class="line"/>`,
	grin: `<path d="M104 197 Q128 230 152 197 Z" fill="${INK}"/><path d="M114 201 Q128 208 142 201" stroke="${PAPER}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
};

const QUESTION = "M-10 -8 Q-10 -24 4 -24 Q18 -24 16 -10 Q14 0 4 4 L4 12";
const sparkle = ([x, y, r]) =>
	`<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${INK}" stroke="${PAPER}" stroke-width="3"/>`;
const EXTRA = {
	"": "",
	question: `<g transform="translate(34 70) rotate(-10)" fill="none" stroke-linecap="round"><path d="${QUESTION}" stroke="${PAPER}" stroke-width="18"/><circle cx="4" cy="26" r="10" fill="${PAPER}"/><path d="${QUESTION}" stroke="${INK}" stroke-width="8"/><circle cx="4" cy="26" r="5" fill="${INK}"/></g>`,
	sweat: `<path d="M48 140 Q40 156 46 164 Q54 170 58 160 Q60 150 48 140 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
	sparkle: [[28, 62, 14], [226, 222, 10], [30, 196, 9]].map(sparkle).join(""),
};

export function svg(mood) {
	const m = MOODS[mood];
	if (!m) throw new Error(`unknown mood ${mood} (want ${Object.keys(MOODS).join("|")})`);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -8 288 288" width="288" height="288" role="img" aria-label="Atelier mascot, ${mood}">
<title>Atelier — ${mood}</title>
<defs>
  <filter id="ink" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7"/>
    <feDisplacementMap in="SourceGraphic" scale="3.2"/>
  </filter>
  <style>.line{fill:none;stroke:${INK};stroke-width:6;stroke-linecap:round;stroke-linejoin:round}</style>
</defs>
<g filter="url(#ink)">
  <g stroke="${PAPER}" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" fill="${PAPER}">
    <path d="${HEAD}"/><path d="${BERET}"/><path d="${EAR}"/>
    <path d="M140 46 Q144 30 156 28" stroke-width="30"/>
    <path d="M150 262 L226 186" stroke-width="30"/>
  </g>
  <path d="${HEAD}" fill="${PAPER}" stroke="${INK}" stroke-width="8"/>
  <path d="${EAR}" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
  <path d="M140 48 Q144 32 156 30" stroke="${INK}" stroke-width="9" stroke-linecap="round" fill="none"/>
  <path d="${BERET}" fill="${INK}"/>
  <path d="${BROWS[m.brows]}" class="line" stroke-width="7"/>
  ${EYES[m.eyes]}
  <path d="M130 148 Q120 170 128 176 Q134 178 138 174" class="line" stroke-width="5"/>
  <path d="M128 184 C114 176 98 180 92 190 C88 197 79 194 82 186" class="line" stroke-width="9"/>
  <path d="M128 184 C142 176 158 180 164 190 C168 197 177 194 174 186" class="line" stroke-width="9"/>
  ${MOUTHS[m.mouth]}
  <g stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M152 260 L194 218" stroke-width="10"/>
    <path d="M192 220 L202 210" stroke="${PAPER}" stroke-width="12"/>
    <path d="M198 204 C204 194 216 184 232 176 C226 192 216 204 206 214 Z" fill="${m.accent}" stroke-width="4.5"/>
  </g>
  ${EXTRA[m.extra]}
</g>
</svg>
`;
}

function selfTest() {
	const { t, done } = makeTester("mascot");
	for (const mood of Object.keys(MOODS)) t(`${mood} renders one svg with its accent`, svg(mood).startsWith("<svg") && svg(mood).includes(MOODS[mood].accent));
	let threw = false;
	try { svg("sleepy"); } catch { threw = true; }
	t("an unknown mood throws", threw);
	return done();
}

if (isMain(import.meta.url)) {
	if (process.argv[2] === "--self-test") process.exit(selfTest());
	const out = process.argv[2] || ".";
	mkdirSync(out, { recursive: true });
	for (const mood of Object.keys(MOODS)) writeFileSync(`${out}/${mood}.svg`, svg(mood));
	console.log(Object.keys(MOODS).join(" "));
}
