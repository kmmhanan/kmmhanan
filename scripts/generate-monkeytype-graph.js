const https = require("https");
const fs = require("fs");
const path = require("path");

const APE_KEY = process.env.MONKEYTYPE_APE_KEY;
const MAX_RESULTS = 1000;

if (!APE_KEY) {
  console.error("Missing MONKEYTYPE_APE_KEY environment variable.");
  process.exit(1);
}

function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.monkeytype.com",
        path: pathname,
        method: "GET",
        headers: {
          Authorization: `ApeKey ${APE_KEY}`,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Monkeytype API ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function buildSvg(points, { bg, line, dot, text, grid }) {
  const width = 900;
  const height = 300;
  const padding = { top: 30, right: 30, bottom: 40, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const wpms = points.map((p) => p.wpm);
  const minWpm = Math.max(0, Math.floor(Math.min(...wpms) - 5));
  const maxWpm = Math.ceil(Math.max(...wpms) + 5);
  const minTs = points[0].timestamp;
  const maxTs = points[points.length - 1].timestamp;
  const tsRange = Math.max(1, maxTs - minTs);

  const x = (ts) => padding.left + ((ts - minTs) / tsRange) * plotW;
  const y = (wpm) =>
    padding.top + plotH - ((wpm - minWpm) / (maxWpm - minWpm)) * plotH;

  const linePoints = points
    .map((p) => `${x(p.timestamp).toFixed(1)},${y(p.wpm).toFixed(1)}`)
    .join(" ");

  const best = points.reduce((a, b) => (b.wpm > a.wpm ? b : a));
  const avg = wpms.reduce((a, b) => a + b, 0) / wpms.length;

  const gridLines = [];
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const gy = padding.top + (plotH / gridCount) * i;
    const val = Math.round(maxWpm - ((maxWpm - minWpm) / gridCount) * i);
    gridLines.push(
      `<line x1="${padding.left}" y1="${gy.toFixed(1)}" x2="${width - padding.right}" y2="${gy.toFixed(1)}" stroke="${grid}" stroke-width="1" stroke-dasharray="4 4" />`,
      `<text x="${padding.left - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${text}" font-family="JetBrains Mono, monospace">${val}</text>`,
    );
  }

  const dateFmt = (ts) =>
    new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${bg}" rx="8" />
  ${gridLines.join("\n  ")}
  <text x="${padding.left}" y="18" font-size="13" fill="${text}" font-family="JetBrains Mono, monospace" font-weight="600">WPM — all-time (last ${points.length} tests)</text>
  <text x="${width - padding.right}" y="18" text-anchor="end" font-size="12" fill="${text}" font-family="JetBrains Mono, monospace">best ${best.wpm} · avg ${avg.toFixed(1)}</text>
  <polyline points="${linePoints}" fill="none" stroke="${line}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  <circle cx="${x(best.timestamp).toFixed(1)}" cy="${y(best.wpm).toFixed(1)}" r="3.5" fill="${dot}" />
  <text x="${padding.left}" y="${height - 12}" font-size="11" fill="${text}" font-family="JetBrains Mono, monospace">${dateFmt(minTs)}</text>
  <text x="${width - padding.right}" y="${height - 12}" text-anchor="end" font-size="11" fill="${text}" font-family="JetBrains Mono, monospace">${dateFmt(maxTs)}</text>
</svg>`;
}

async function main() {
  const res = await apiGet(`/results?limit=${MAX_RESULTS}`);
  const raw = res.data || [];

  if (raw.length === 0) {
    console.error("No results returned from Monkeytype API.");
    process.exit(1);
  }

  const points = raw
    .filter((r) => typeof r.wpm === "number" && typeof r.timestamp === "number")
    .sort((a, b) => a.timestamp - b.timestamp);

  const outDir = path.join(__dirname, "..", "public");
  fs.mkdirSync(outDir, { recursive: true });

  const dark = buildSvg(points, {
    bg: "#000000",
    line: "#ffffff",
    dot: "#ffffff",
    text: "#ffffff",
    grid: "#333333",
  });
  const light = buildSvg(points, {
    bg: "#ffffff",
    line: "#000000",
    dot: "#000000",
    text: "#000000",
    grid: "#dddddd",
  });

  fs.writeFileSync(path.join(outDir, "monkeytype-wpm-dark.svg"), dark);
  fs.writeFileSync(path.join(outDir, "monkeytype-wpm-light.svg"), light);

  console.log(`Wrote graph for ${points.length} results.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
