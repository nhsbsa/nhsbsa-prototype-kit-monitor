const fs = require('fs');
const fetch = require('node-fetch');
const semver = require('semver');

const ORG = 'nhsbsa';
const OUTPUT_HTML = 'index.html';
const GITHUB_TOKEN = process.env.GH_TOKEN;

const NHS_TEMPLATE_PKG_URL = 'https://raw.githubusercontent.com/nhsuk/nhsuk-prototype-kit/main/package.json';
const GOV_TEMPLATE_PKG_URL = 'https://raw.githubusercontent.com/alphagov/govuk-prototype-kit/main/package.json';

async function fetchLatestVersion(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch template version from ${url}: HTTP ${res.status}`);
  const pkg = await res.json();
  return pkg.version;
}

async function getAllRepos() {
  let page = 1;
  const repos = [];

  while (true) {
    const res = await fetch(`https://api.github.com/orgs/${ORG}/repos?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'version-check-script'
      }
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`GitHub API error (status ${res.status}): ${errorText}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error('❌ Unexpected GitHub API response:', data);
      throw new Error('Expected array of repos but got non-array');
    }

    const activeRepos = data.filter(repo => !repo.archived);
    repos.push(...activeRepos);

    if (data.length < 100) break;
    page++;
  }

  return repos;
}

async function getPackageDetails(repoName, defaultBranch = 'main') {
  const url = `https://raw.githubusercontent.com/${ORG}/${repoName}/${defaultBranch}/package.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[${repoName}] No package.json (HTTP ${res.status})`);
      return null;
    }
    const pkg = await res.json();
    return pkg;
  } catch (err) {
    console.error(`[${repoName}] Error fetching or parsing package.json: ${err.message}`);
    return null;
  }
}

function getStatus(repoVersion, latestVersion) {
  const minVersion = semver.minVersion(repoVersion);
  if (!minVersion) return { text: '❓ Unknown', className: 'unknown' };

  if (semver.eq(minVersion, latestVersion)) {
    return { text: '✅ Up-To-Date', className: 'uptodate' };
  }
  if (semver.major(minVersion) === semver.major(latestVersion)) {
    return { text: '⚠️ Slightly Outdated', className: 'slightly-outdated' };
  }
  return { text: '❌ Outdated', className: 'outdated' };
}

function generateTable(title, results, latestVersion) {
  if (results.length === 0) return '';

  return `
    <h2>${title}</h2>
    <p>Latest version: <strong>${latestVersion}</strong></p>
    <table>
      <thead>
        <tr>
          <th>Repository</th>
          <th>Version</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${results.map(r => `
          <tr class="${r.className}">
            <td><a href="https://github.com/${ORG}/${r.name}">${r.name}</a></td>
            <td>
              ${r.version}<br/>
              ${r.frontendVersion ? `<small>Frontend: ${r.frontendVersion}</small>` : ''}
            </td>
            <td>${r.text}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

async function run() {
  const [nhsLatest, govLatest] = await Promise.all([
    fetchLatestVersion(NHS_TEMPLATE_PKG_URL),
    fetchLatestVersion(GOV_TEMPLATE_PKG_URL)
  ]);

  console.log(`Latest NHS version: ${nhsLatest}`);
  console.log(`Latest GOV.UK version: ${govLatest}`);

  const repos = await getAllRepos();
  const nhsResults = [];
  const govResults = [];

  for (const repo of repos) {
    const pkg = await getPackageDetails(repo.name, repo.default_branch);
    if (!pkg) continue;

    const dependencies = pkg.dependencies || {};
    const nhsKitVersion = dependencies['nhsuk-prototype-kit'];
    const govKitVersion = dependencies['govuk-prototype-kit'];

    const nhsFrontendVersion = dependencies['nhsuk-frontend'] || '';
    const govFrontendVersion = dependencies['govuk-frontend'] || '';

    if (nhsKitVersion) {
      const status = getStatus(nhsKitVersion, nhsLatest);
      nhsResults.push({
        name: repo.name,
        version: nhsKitVersion,
        frontendVersion: nhsFrontendVersion,
        ...status
      });
    } else if (govKitVersion) {
      const status = getStatus(govKitVersion, govLatest);
      govResults.push({
        name: repo.name,
        version: govKitVersion,
        frontendVersion: govFrontendVersion,
        ...status
      });
    }
  }

  nhsResults.sort((a, b) => semver.rcompare(semver.minVersion(a.version), semver.minVersion(b.version)));
  govResults.sort((a, b) => semver.rcompare(semver.minVersion(a.version), semver.minVersion(b.version)));

  const lastUpdated = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Prototype Kit Version Report</title>
    <style>
      body { font-family: sans-serif; padding: 2em; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 2em; }
      th, td { border: 1px solid #ccc; padding: 0.5em; text-align: left; }
      th { background: #eee; }
      .uptodate { background-color: #d4edda; }
      .slightly-outdated { background-color: #fff3cd; }
      .outdated { background-color: #f8d7da; }
      .unknown { background-color: #e2e3e5; }
      .last-updated { margin-top: 1em; font-style: italic; color: #555; }
    </style>
  </head>
  <body>
    <h1>NHSBSA Prototype Kit Version Report</h1>
    ${generateTable('NHS Prototype Kit', nhsResults, nhsLatest)}
    ${generateTable('GOV.UK Prototype Kit', govResults, govLatest)}
    <p class="last-updated">Last Updated: ${lastUpdated}</p>
  </body>
  </html>`;

  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`\n✅ Report written to ${OUTPUT_HTML}`);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
