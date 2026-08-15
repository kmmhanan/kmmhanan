// Finds your single best (highest wpm) 60-second Monkeytype test and
// renders its actual per-second speed graph — the same chartData the
// Monkeytype result page itself uses — as a black & white SVG:
//   - white curve  = wpm (smoothed, per-second, as returned by the API)
//   - gray curve   = burst (raw per-second speed, jagged)
//   - faint white fill under the wpm curve
//   - "wpm X   acc Y%" summary line, no error markers
//
// This only ever looks at ONE test result (your best 60s one), not your
// whole history, so it's light on API calls:
//   1) GET /results?limit=1000        -> find the best time/60 result's id
//   2) GET /results/id/{id}           -> pull its chartData
//
// Docs: https://api.monkeytype.com/docs
// Auth: Authorization: ApeKey <key>

const https = require("https");
const fs = require("fs");
const path = require("path");

const APE_KEY = process.env.MONKEYTYPE_APE_KEY;

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

function buildSvg(result) {
  const width = 1400;
  const height = 420;
  const padding = { top: 60, right: 40, bottom: 40, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const wpmSeries = result.chartData.wpm;
  const burstSeries = result.chartData.burst;
  const seconds = wpmSeries.length;

  const allVals = [...wpmSeries, ...burstSeries];
  const maxVal = Math.max(...allVals);
  const yMax = Math.max(10, Math.ceil((maxVal + 5) / 10) * 10);

  const x = (i) => padding.left + (i / (seconds - 1)) * plotW;
  const y = (v) => padding.top + plotH - (v / yMax) * plotH;
  const bottomY = padding.top + plotH;

  const wpmPoints = wpmSeries.map((v, i) => [x(i), y(v)]);
  const burstPoints = burstSeries.map((v, i) => [x(i), y(v)]);

  const wpmPath = smoothPath(wpmPoints);
  const burstPath = smoothPath(burstPoints);
  const wpmFillPath = `${wpmPath} L ${wpmPoints[wpmPoints.length - 1][0].toFixed(1)} ${bottomY.toFixed(1)} L ${wpmPoints[0][0].toFixed(1)} ${bottomY.toFixed(1)} Z`;

  // Gridlines every 10 units.
  const gridLines = [];
  for (let v = 0; v <= yMax; v += 10) {
    const gy = y(v);
    gridLines.push(
      `<line x1="${padding.left}" y1="${gy.toFixed(1)}" x2="${width - padding.right}" y2="${gy.toFixed(1)}" stroke="#2a2a2a" stroke-width="1" />`,
      `<text x="${padding.left - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#888888" font-family="JetBrains Mono, monospace">${v}</text>`,
    );
  }

  // X axis second labels, every 5s.
  const xLabels = [];
  for (let i = 0; i < seconds; i += 5) {
    xLabels.push(
      `<text x="${x(i).toFixed(1)}" y="${height - padding.bottom + 20}" text-anchor="middle" font-size="10" fill="#666666" font-family="JetBrains Mono, monospace">${i + 1}</text>`,
    );
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#000000" />
  <text x="${(padding.left + plotW / 2).toFixed(1)}" y="34" text-anchor="middle" font-size="22" fill="#ffffff" font-family="JetBrains Mono, monospace" font-weight="600">wpm ${result.wpm}     acc ${Math.round(result.acc)}%</text>
  ${gridLines.join("\n  ")}
  ${xLabels.join("\n  ")}
  <text transform="translate(16, ${padding.top + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#888888" font-family="JetBrains Mono, monospace">Words per Minute</text>
  <path d="${wpmFillPath}" fill="#ffffff" fill-opacity="0.06" stroke="none" />
  <path d="${burstPath}" fill="none" stroke="#888888" stroke-width="1.5" stroke-linecap="round" />
  <path d="${wpmPath}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
</svg>`;
}

async function main() {
  // 1) Find the best time/60 result's id (light: we only keep wpm/id/mode fields we need).
  const listRes = await apiGet("/results?limit=1000");
  const all = listRes.data || [];
  const sixty = all.filter(
    (r) => r.mode === "time" && String(r.mode2) === "60",
  );

  if (sixty.length === 0) {
    console.error("No 60-second test results found.");
    process.exit(1);
  }

  const best = sixty.reduce((a, b) => (b.wpm > a.wpm ? b : a));

  // 2) Pull the full result (with chartData) for that one test only.
  const detailRes = await apiGet(`/results/id/${best._id}`);
  const result = detailRes.data;

  if (
    !result.chartData ||
    !result.chartData.wpm ||
    result.chartData.wpm.length === 0
  ) {
    console.error("Best result has no chart data available.");
    process.exit(1);
  }

  const outDir = path.join(__dirname, "..", "public");
  fs.mkdirSync(outDir, { recursive: true });

  const svg = buildSvg(result);
  fs.writeFileSync(path.join(outDir, "monkeytype-graph.svg"), svg);

  console.log(
    `Wrote graph for best 60s result: ${result.wpm} wpm / ${result.acc}% acc.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
