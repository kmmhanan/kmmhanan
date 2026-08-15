// Fetches your Monkeytype 60-second test history via the official API
// (authenticated with an Ape Key) and renders a black & white smoothed
// curve graph: WPM (white line, right axis) and Accuracy (gray line with
// a faint white fill beneath it, left axis), with a plain "wpm X  acc Y%"
// summary line.
//
// Docs: https://api.monkeytype.com/docs  (GET /results)
// Auth: Authorization: ApeKey <key>
//
// Note: the API caps a single request at 1000 results and this script
// does not paginate further back, so this covers your most recent 1000
// tests overall, filtered down to the 60s ones.

const https = require("https");
const fs = require("fs");
const path = require("path");

const APE_KEY = process.env.MONKEYTYPE_APE_KEY;
const MAX_RESULTS = 1000;
const SMOOTH_WINDOW = 20; // rolling average window before curving, tune to taste

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
        headers: { Authorization: `ApeKey ${APE_KEY}` },
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

function rollingAvg(values, window) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    const count = Math.min(i + 1, window);
    out.push(sum / count);
  }
  return out;
}

// Catmull-Rom -> cubic bezier smooth path through a series of points.
function smoothPath(pointsArr) {
  if (pointsArr.length < 2) return "";
  let d = `M ${pointsArr[0][0].toFixed(1)} ${pointsArr[0][1].toFixed(1)}`;
  for (let i = 0; i < pointsArr.length - 1; i++) {
    const p0 = pointsArr[i - 1] || pointsArr[i];
    const p1 = pointsArr[i];
    const p2 = pointsArr[i + 1];
    const p3 = pointsArr[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function buildSvg(points) {
  const width = 1400;
  const height = 420;
  const padding = { top: 60, right: 60, bottom: 40, left: 60 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const n = points.length;
  const minTs = points[0].timestamp;
  const maxTs = points[n - 1].timestamp;
  const tsRange = Math.max(1, maxTs - minTs);

  const wpmValues = points.map((p) => p.wpm);
  const accValues = points.map((p) => p.acc);
  const rightMax = Math.max(
    10,
    Math.ceil((Math.max(...wpmValues) + 5) / 10) * 10,
  );
  const leftMax = 100;

  const x = (ts) => padding.left + ((ts - minTs) / tsRange) * plotW;
  const yAcc = (acc) => padding.top + (acc / leftMax) * plotH;
  const yWpm = (wpm) => padding.top + plotH - (wpm / rightMax) * plotH;
  const bottomY = padding.top + plotH;

  const wpmSmoothed = rollingAvg(wpmValues, SMOOTH_WINDOW);
  const accSmoothed = rollingAvg(accValues, SMOOTH_WINDOW);

  const wpmCurvePoints = points.map((p, i) => [
    x(p.timestamp),
    yWpm(wpmSmoothed[i]),
  ]);
  const accCurvePoints = points.map((p, i) => [
    x(p.timestamp),
    yAcc(accSmoothed[i]),
  ]);

  const wpmPath = smoothPath(wpmCurvePoints);
  const accPath = smoothPath(accCurvePoints);

  // Closed fill path: accuracy curve down to the bottom axis, faint white.
  const accFillPath = `${accPath} L ${accCurvePoints[accCurvePoints.length - 1][0].toFixed(1)} ${bottomY.toFixed(1)} L ${accCurvePoints[0][0].toFixed(1)} ${bottomY.toFixed(1)} Z`;

  // Gridlines every 10 units on the left (0-100) scale.
  const gridLines = [];
  for (let v = 0; v <= 100; v += 10) {
    const gy = padding.top + (v / leftMax) * plotH;
    const rightVal = Math.round(rightMax * (1 - v / 100));
    gridLines.push(
      `<line x1="${padding.left}" y1="${gy.toFixed(1)}" x2="${width - padding.right}" y2="${gy.toFixed(1)}" stroke="#2a2a2a" stroke-width="1" />`,
      `<text x="${padding.left - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#888888" font-family="JetBrains Mono, monospace">${v}</text>`,
      `<text x="${width - padding.right + 10}" y="${(gy + 4).toFixed(1)}" text-anchor="start" font-size="11" fill="#888888" font-family="JetBrains Mono, monospace">${rightVal}</text>`,
    );
  }

  const avgWpm = wpmValues.reduce((a, b) => a + b, 0) / wpmValues.length;
  const avgAcc = accValues.reduce((a, b) => a + b, 0) / accValues.length;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#000000" />
  <text x="${(padding.left + plotW / 2).toFixed(1)}" y="34" text-anchor="middle" font-size="22" fill="#ffffff" font-family="JetBrains Mono, monospace" font-weight="600">wpm ${avgWpm.toFixed(1)}     acc ${avgAcc.toFixed(0)}%</text>
  ${gridLines.join("\n  ")}
  <text transform="translate(16, ${padding.top + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#888888" font-family="JetBrains Mono, monospace">Accuracy</text>
  <text transform="translate(${width - 16}, ${padding.top + plotH / 2}) rotate(90)" text-anchor="middle" font-size="12" fill="#888888" font-family="JetBrains Mono, monospace">Words per Minute</text>
  <path d="${accFillPath}" fill="#ffffff" fill-opacity="0.06" stroke="none" />
  <path d="${accPath}" fill="none" stroke="#888888" stroke-width="2" stroke-linecap="round" />
  <path d="${wpmPath}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
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
    .filter(
      (r) =>
        r.mode === "time" &&
        String(r.mode2) === "60" &&
        typeof r.wpm === "number" &&
        typeof r.acc === "number" &&
        typeof r.timestamp === "number",
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length === 0) {
    console.error("No 60-second test results found in the fetched data.");
    process.exit(1);
  }

  const outDir = path.join(__dirname, "..", "public");
  fs.mkdirSync(outDir, { recursive: true });

  const svg = buildSvg(points);
  fs.writeFileSync(path.join(outDir, "monkeytype-graph.svg"), svg);

  console.log(`Wrote graph for ${points.length} 60s results.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
