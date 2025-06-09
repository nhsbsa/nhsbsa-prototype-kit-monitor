
const fs = require('fs');
const fetch = require('node-fetch');

const ORG = 'nhsbsa';
const NHS_TEMPLATE_REPO = 'nhsuk-prototype-kit';
const GOV_TEMPLATE_REPO = 'govuk-prototype-kit';

const NHS_TEMPLATE_PKG_URL = `https://raw.githubusercontent.com/nhsbsa/${NHS_TEMPLATE_REPO}/main/package.json`;
const GOV_TEMPLATE_PKG_URL = `https://raw.githubusercontent.com/alphagov/${GOV_TEMPLATE_REPO}/main/package.json`;

const OUTPUT_HTML = 'index.html';

const GITHUB_TOKEN = process.env.GH_TOKEN;

function parseVersion(version) {
  // Parses a version string into [major, minor, patch]
  const [major, minor, patch] = version.split('.').map(n => parseInt(n, 10));
  return [major || 0, minor || 0, patch || 0];
}

function compareVersions(current, latest) {
  // Returns:
  // 0 if equal
  // 1 if slightly outdated (patch-level difference)
  // 2 if outdated (major or minor difference)
  const [cMaj, cMin, cPatch] = parseVersion(current);
  const [lMaj, lMin, lPatch] = parseVersion(latest);

  if (cMaj === lMaj && cMin === lMin && cPatch === lPatch) return 0;
  if (cMaj === lMaj && cMin === lMin && cPatch < lPatch) return 1;
  return 2;
}

async function getLatestTemplateVersion(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch template version: HTTP ${res.status}`);
  const raw = await res.text();
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in template package.json: ${err.message}`);
  }
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

    repos.push(...data);

    if (data.length < 100) break; // Last page
    page++;
  }

  return repos.filter(repo => !repo.archived);
}

async function getPackageVersion(repoName, defaultBranch = 'main') {
  const url = `https://raw.githubusercontent.com/${ORG}/${repoName}/${defaultBranch}/package.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[${repoName}] No package.json (HTTP ${res.status})`);
      return null;
    }
    const raw = await res.text();
    let pkg;
    try {
      pkg = JSON.parse(raw);
    } catch (err) {
      console.error(`[${repoName}] Invalid JSON in package.json: ${err.message}`);
      return null;
    }

    const { name, version, dependencies } = pkg || {};
    if (!name && !dependencies) {
      console.log(`[${repoName}] Skipped - no name or dependencies found`);
      return null;
    }

    // NHS Prototype Kit checks
    if (name === NHS_TEMPLATE_REPO) {
      console.log(`[${repoName}] Included - NHS Prototype Kit version: ${version}`);
      return { repo: repoName, kit: 'nhs', version };
    } else if (dependencies && dependencies[NHS_TEMPLATE_REPO]) {
      const depVersion = dependencies[NHS_TEMPLATE_REPO].replace(/^[^\d]*/, '');
      console.log(`[${repoName}] Included - NHS Prototype Kit dependency version: ${depVersion}`);
      return { repo: repoName, kit: 'nhs', version: depVersion };
    }

    // GOV Prototype Kit checks
    if (name === GOV_TEMPLATE_REPO) {
      console.log(`[${repoName}] Included - GOV Prototype Kit version: ${version}`);
      return { repo: repoName, kit: 'gov', version };
    } else if (dependencies && dependencies[GOV_TEMPLATE_REPO]) {
      const depVersion = dependencies[GOV_TEMPLATE_REPO].replace(/^[^\d]*/, '');
      console.log(`[${repoName}] Included - GOV Prototype Kit dependency version: ${depVersion}`);
      return { repo: repoName, kit: 'gov', version: depVersion };
    }

    console.log(`[${repoName}] Skipped - no matching prototype kit found`);
    return null;

  } catch (err) {
    console.error(`[${repoName}] Error fetching package.json: ${err.message}`);
    return null;
  }
}

function formatDate(date) {
  // Format date like "9th January 2025"
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st' :
                 day % 10 === 2 && day !== 12 ? 'nd' :
                 day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
  return `${day}${suffix} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

async function run() {
  const latestNHSVersion = await getLatestTemplateVersion(NHS_TEMPLATE_PKG_URL);
  const latestGOVVersion = await getLatestTemplateVersion(GOV_TEMPLATE_PKG_URL);

  console.log(`Latest NHS Prototype Kit version: ${latestNHSVersion}`);
  console.log(`Latest GOV Prototype Kit version: ${latestGOVVersion}
`);

  const repos = await getAllRepos();

  const nhsResults = [];
  const govResults = [];

  for (const repo of repos) {
    const pkgInfo = await getPackageVersion(repo.name, repo.default_branch);
    if (pkgInfo) {
      const latest = pkgInfo.kit === 'nhs' ? latestNHSVersion : latestGOVVersion;
      const statusNum = compareVersions(pkgInfo.version, latest);
      const statusText = statusNum === 0 ? '✅ Up-To-Date' :
                         statusNum === 1 ? '⚠️ Slightly Outdated' : '❌ Outdated';
      nhsResults.push && pkgInfo.kit === 'nhs' && nhsResults.push({
        name: pkgInfo.repo,
        version: pkgInfo.version,
        statusNum,
        statusText,
      });
      govResults.push && pkgInfo.kit === 'gov' && govResults.push({
        name: pkgInfo.repo,
        version: pkgInfo.version,
        statusNum,
        statusText,
      });
    }
  }

  // Sort each table by newest version first
  nhsResults.sort((a, b) => {
    if (a.statusNum !== b.statusNum) return a.statusNum - b.statusNum;
    // fallback to version descending
    return compareVersions(b.version, a.version);
  });
  govResults.sort((a, b) => {
    if (a.statusNum !== b.statusNum) return a.statusNum - b.statusNum;
    return compareVersions(b.version, a.version);
  });

  function rowClass(statusNum) {
    return statusNum === 0 ? 'uptodate' :
           statusNum === 1 ? 'slightly' :
           'outdated';
  }

  const lastUpdated = formatDate(new Date());

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
  .uptodate { background: #d4edda; }
  .slightly { background: #fff3cd; }
  .outdated { background: #f8d7da; }
  h2 { margin-top: 2em; }
  .last-updated { font-style: italic; margin-top: 1em; }
</style>
</head>
<body>
  <h1>NHSBSA Prototype Kit Version Report</h1>

  <h2>NHS Prototype Kit</h2>
  <p>Latest version: <strong>${latestNHSVersion}</strong></p>
  <table>
    <thead>
      <tr><th>Repository</th><th>Version</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${nhsResults.map(r => `
      <tr class="${rowClass(r.statusNum)}">
        <td><a href="https://github.com/${ORG}/${r.name}">${r.name}</a></td>
        <td>${r.version}</td>
        <td>${r.statusText}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <h2>GOV Prototype Kit</h2>
  <p>Latest version: <strong>${latestGOVVersion}</strong></p>
  <table>
    <thead>
      <tr><th>Repository</th><th>Version</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${govResults.map(r => `
      <tr class="${rowClass(r.statusNum)}">
        <td><a href="https://github.com/${ORG}/${r.name}">${r.name}</a></td>
        <td>${r.version}</td>
        <td>${r.statusText}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <p class="last-updated">Last Updated: ${lastUpdated}</p>
</body>
</html>
`;

  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`
✅ Report written to ${OUTPUT_HTML}`);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
