const fs = require('fs');
const fetch = require('node-fetch');

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

async function getPackageDetails(repoName, branch = 'main') {
  const cleanBranch = branch.replace(/^refs\/heads\//, '');
  const url = `https://raw.githubusercontent.com/${ORG}/${repoName}/${cleanBranch}/package.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[${repoName}] No package.json (HTTP ${res.status})`);
      return null;
    }

    const pkg = await res.json();

    const govukPrototypeKitVersion =
      pkg['govuk-prototype-kit'] ||
      (pkg.dependencies && pkg.dependencies['govuk-prototype-kit']) ||
      (pkg.devDependencies && pkg.devDependencies['govuk-prototype-kit']) ||
      null;

    const isGovukOnly = Boolean(govukPrototypeKitVersion);
    const isValid = pkg.name && pkg.version;

    if (!isValid && !isGovukOnly) {
      console.log(`[${repoName}] Skipped - invalid package.json`);
      return null;
    }

    console.log(`[${repoName}] Detected` +
      (pkg.name ? ` - ${pkg.name}` : '') +
      (pkg.version ? ` v${pkg.version}` : '') +
      (govukPrototypeKitVersion ? ` (govuk-prototype-kit: ${govukPrototypeKitVersion})` : '')
    );

    return {
      name: pkg.name || repoName,
      version: pkg.version || govukPrototypeKitVersion,
      govukPrototypeKitVersion
    };
  } catch (err) {
    console.error(`[${repoName}] Error fetching package.json: ${err.message}`);
    return null;
  }
}

function parseVersion(v) {
  return v.split('.').map(n => parseInt(n, 10));
}

function compareVersionsDesc(a, b) {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return bMajor - aMajor;
  if (aMinor !== bMinor) return bMinor - aMinor;
  return bPatch - aPatch;
}

function getStatus(repoVersion, latestVersion) {
  const [rMajor, rMinor] = parseVersion(repoVersion);
  const [lMajor, lMinor] = parseVersion(latestVersion);

  if (repoVersion === latestVersion) {
    return { text: '✅ Up-To-Date', className: 'uptodate' };
  }
  if (rMajor === lMajor) {
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
            <td>${r.version}</td>
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

    if (pkg.name === 'nhsuk-prototype-kit') {
      const status = getStatus(pkg.version, nhsLatest);
      nhsResults.push({
        name: repo.name,
        version: pkg.version,
        ...status
      });
    } else if (
      pkg.name === 'govuk-prototype-kit' ||
      pkg.govukPrototypeKitVersion
    ) {
      const versionToUse = pkg.govukPrototypeKitVersion || pkg.version;
      const status = getStatus(versionToUse, govLatest);
      govResults.push({
        name: repo.name,
        version: versionToUse,
        ...status
      });
    }
  }

  nhsResults.sort((a, b) => compareVersionsDesc(a.version, b.version));
  govResults.sort((a, b) => compareVersionsDesc(a.version, b.version));

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
