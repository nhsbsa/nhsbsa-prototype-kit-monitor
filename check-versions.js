const fs = require('fs');
const fetch = require('node-fetch');

const ORG = 'nhsbsa';
const TEMPLATE_REPO = 'nhsuk-prototype-kit';
const TEMPLATE_PKG_URL = `https://raw.githubusercontent.com/nhsuk/${TEMPLATE_REPO}/main/package.json`;
const OUTPUT_HTML = 'index.html';

const GITHUB_TOKEN = process.env.GH_TOKEN;

async function getLatestTemplateVersion() {
  const res = await fetch(TEMPLATE_PKG_URL);
  if (!res.ok) throw new Error(`Failed to fetch template version: HTTP ${res.status}`);
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

    if (data.length < 100) break; // Last page
    page++;
  }

  return repos;
}

async function getPackageVersion(repoName, defaultBranch = 'main') {
  const url = `https://raw.githubusercontent.com/${ORG}/${repoName}/${defaultBranch}/package.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[${repoName}] No package.json (HTTP ${res.status})`);
      return null;
    }
    const pkg = await res.json();
    if (pkg.name !== 'nhsuk-prototype-kit') {
      console.log(`[${repoName}] Skipped - name is '${pkg.name}'`);
      return null;
    }
    console.log(`[${repoName}] Included - version: ${pkg.version}`);
    return pkg.version;
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

async function run() {
  const latestVersion = await getLatestTemplateVersion();
  console.log(`Latest prototype kit version: ${latestVersion}\n`);

  const repos = await getAllRepos();
  const results = [];

  for (const repo of repos) {
    const version = await getPackageVersion(repo.name, repo.default_branch);
    if (version) {
      const status = getStatus(version, latestVersion);
      results.push({
        name: repo.name,
        version,
        ...status
      });
    }
  }

  results.sort((a, b) => compareVersionsDesc(a.version, b.version));

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
      table { border-collapse: collapse; width: 100%; }
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
    <p>Current NHS Prototype Kit version: <strong>${latestVersion}</strong></p>
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
