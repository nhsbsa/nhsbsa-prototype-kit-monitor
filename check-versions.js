const fs = require('fs');
const fetch = require('node-fetch');
const semver = require('semver');

const ORG = 'nhsbsa';
const OUTPUT_HTML = 'index.html';
const GITHUB_TOKEN = process.env.GH_TOKEN;

const NHS_TEMPLATE_PKG_URL =
  'https://raw.githubusercontent.com/nhsuk/nhsuk-prototype-kit/main/package.json';
const GOV_TEMPLATE_PKG_URL =
  'https://raw.githubusercontent.com/alphagov/govuk-prototype-kit/main/package.json';

async function fetchLatestVersion(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch template version from ${url}: HTTP ${res.status}`);
  }

  const pkg = await res.json();

  // NHS kit now declares itself as a dependency
  if (pkg.dependencies?.['nhsuk-prototype-kit']) {
    return pkg.dependencies['nhsuk-prototype-kit'];
  }

  return pkg.version;
}

async function getAllRepos() {
  let page = 1;
  const repos = [];

  while (true) {
    const res = await fetch(
      `https://api.github.com/orgs/${ORG}/repos?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': 'version-check-script'
        }
      }
    );

    if (!res.ok) {
      throw new Error(`GitHub API error (status ${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Expected array of repos but got non-array');
    }

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

    // ✅ MODERN: dependency-based usage
    const nhsKitFromDeps = dependencies['nhsuk-prototype-kit'];

    // ✅ LEGACY: only if the repo *is* the kit
    const nhsKitFromLegacy =
      pkg.name === 'nhsuk-prototype-kit' &&
      typeof pkg.version === 'string' &&
      semver.valid(pkg.version)
        ? pkg.version
        : null;

    const nhsKitVersion = nhsKitFromDeps || nhsKitFromLegacy;

    // GOV.UK logic (unchanged but equivalent)
    const govKitVersion =
      dependencies['govuk-prototype-kit'] ||
      (pkg.name === 'govuk-prototype-kit' &&
        typeof pkg.version === 'string' &&
        semver.valid(pkg.version)
          ? pkg.version
          : null);

    if (!nhsKitVersion && !govKitVersion) return null;

    return {
      name: repoName,
      nhsKitVersion,
      govKitVersion,
      nhsFrontend: dependencies['nhsuk-frontend'],
      govFrontend: dependencies['govuk-frontend']
    };
  } catch (err) {
    console.warn(`[${repoName}] Skipped - ${err.message}`);
    return null;
  }
}

async function getLastCommitter(repoName, branch = 'main') {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${repoName}/commits?sha=${branch}&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': 'version-check-script'
        }
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const commit = data[0];
    if (!commit) return null;

    return (
      commit.commit?.author?.name ||
      commit.author?.login ||
      'Unknown'
    );
  } catch (err) {
    console.warn(`[${repoName}] Failed to get last committer: ${err.message}`);
    return null;
  }
}

function safeMinVersion(v) {
  if (!v || typeof v !== 'string') return null;
  return semver.minVersion(v);
}

function getStatus(repoVersion, latestVersion) {
  const repoMin = safeMinVersion(repoVersion);
  const latestMin = safeMinVersion(latestVersion);

  if (!repoMin || !latestMin) {
    return { text: '❓ Unknown', className: 'unknown' };
  }

  if (semver.eq(repoMin, latestMin)) {
    return { text: '✅ Up-To-Date', className: 'uptodate' };
  }

  if (semver.major(repoMin) === semver.major(latestMin)) {
    return { text: '⚠️ Slightly Outdated', className: 'slightly-outdated' };
  }

  return { text: '❌ Outdated', className: 'outdated' };
}

function compareVersionsDesc(a, b) {
  const av = safeMinVersion(a.version);
  const bv = safeMinVersion(b.version);

  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;

  return semver.rcompare(av, bv);
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
          <th>Kit Version</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${results.map(r => `
          <tr class="${r.className}">
            <td>
              <a href="https://github.com/${ORG}/${r.name}">${r.name}</a>
              ${r.frontend ? `<br/><small>Frontend: ${r.frontend}</small>` : ''}
              ${r.lastCommitter ? `<br/><small>Last commit made by: ${r.lastCommitter}</small>` : ''}
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
      nhsResults.push({
        name: repo.name,
        version: pkg.nhsKitVersion,
        frontend: pkg.nhsFrontend,
        lastCommitter,
        ...getStatus(pkg.nhsKitVersion, nhsLatest)
      });
    }

    if (pkg.govKitVersion) {
      govResults.push({
        name: repo.name,
        version: pkg.govKitVersion,
        frontend: pkg.govFrontend,
        lastCommitter,
        ...getStatus(pkg.govKitVersion, govLatest)
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
