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

    if (!res.ok) throw new Error(`GitHub API error (status ${res.status}): ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Expected array of repos but got non-array');

    repos.push(...data.filter(repo => !repo.archived));
    if (data.length < 100) break;
    page++;
  }

  return repos;
}

async function getPackageDetails(repoName, defaultBranch = 'main') {
  const url = `https://raw.githubusercontent.com/${ORG}/${repoName}/${defaultBranch}/package.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const pkg = await res.json();

    const dependencies = pkg.dependencies || {};
    const name = pkg.name || '';
    const version = pkg.version || '';
    const govKit = name === 'govuk-prototype-kit' || dependencies['govuk-prototype-kit'];
    const nhsKit = name === 'nhsuk-prototype-kit' || dependencies['nhsuk-prototype-kit'];

    if (!govKit && !nhsKit) return null;

    return {
      name: name,
      version: version || dependencies[name],
      repo: repoName,
      govKitVersion: name === 'govuk-prototype-kit' ? version : dependencies['govuk-prototype-kit'],
      nhsKitVersion: name === 'nhsuk-prototype-kit' ? version : dependencies['nhsuk-prototype-kit'],
      govFrontend: dependencies['govuk-frontend'],
      nhsFrontend: dependencies['nhsuk-frontend']
    };
  } catch (err) {
    console.warn(`[${repoName}] Skipped - ${err.message}`);
    return null;
  }
}

async function getLastCommitter(repoName, branch = 'main') {
  try {
    const res = await fetch(`https://api.github.com/repos/${ORG}/${repoName}/commits?sha=${branch}&per_page=1`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'version-check-script'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const commit = data[0];
    if (!commit) return null;
    return commit.commit?.author?.name || commit.author?.login || 'Unknown';
  } catch (err) {
    console.warn(`[${repoName}] Failed to get last committer: ${err.message}`);
    return null;
  }
}

function getStatus(repoVersion, latestVersion) {
  const minVer = semver.minVersion(repoVersion);
  if (!minVer) return { text: '❓ Unknown', className: 'unknown' };
  if (semver.eq(minVer, latestVersion)) return { text: '✅ Up-To-Date', className: 'uptodate' };
  if (semver.major(minVer) === semver.major(latestVersion)) return { text: '⚠️ Slightly Outdated', className: 'slightly-outdated' };
  return { text: '❌ Outdated', className: 'outdated' };
}

function compareVersionsDesc(a, b) {
  return semver.rcompare(semver.minVersion(a.version), semver.minVersion(b.version));
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
            <td>
              <a href="https://github.com/${ORG}/${r.name}">${r.name}</a>
              ${r.frontend ? `<br/><small>Frontend: ${r.frontend}</small>` : ''}
              ${r.lastCommitter ? `<br/><small>Last Committer: ${r.lastCommitter}</small>` : ''}
            </td>
            <td>${r.version}</td>
            <td>${r.text}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function run() {
  const [nhsLatest, govLatest] = await Promise.all([
    fetchLatestVersion(NHS_TEMPLATE_PKG_URL),
    fetchLatestVersion(GOV_TEMPLATE_PKG_URL)
  ]);

  const repos = await getAllRepos();
  const nhsResults = [];
  const govResults = [];

  for (const repo of repos) {
    const pkg = await getPackageDetails(repo.name, repo.default_branch);
    if (!pkg) continue;

    const lastCommitter = await getLastCommitter(repo.name, repo.default_branch);

    if (pkg.nhsKitVersion) {
      const version = semver.minVersion(pkg.nhsKitVersion)?.version || pkg.nhsKitVersion;
      const status = getStatus(version, nhsLatest);
      nhsResults.push({
        name: repo.name,
        version,
        frontend: pkg.nhsFrontend,
        lastCommitter,
        ...status
      });
    }

    if (pkg.govKitVersion) {
      const version = semver.minVersion(pkg.govKitVersion)?.version || pkg.govKitVersion;
      const status = getStatus(version, govLatest);
      govResults.push({
        name: repo.name,
        version,
        frontend: pkg.govFrontend,
        lastCommitter,
        ...status
      });
    }
  }

  nhsResults.sort(compareVersionsDesc);
  govResults.sort(compareVersionsDesc);

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
  console.log(`✅ Report written to ${OUTPUT_HTML}`);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
