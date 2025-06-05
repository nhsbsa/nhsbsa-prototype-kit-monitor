const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const ORG = 'nhsbsa';
const REFERENCE_REPO = 'nhsuk/nhsuk-prototype-kit';
const OUTPUT_DIR = 'output';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''; // use env if calling API

const headers = {
  Accept: 'application/vnd.github.v3+json',
  ...(GITHUB_TOKEN && { Authorization: `token ${GITHUB_TOKEN}` }),
};

async function getRepos(org) {
  const repos = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}`, { headers });
    const data = await res.json();
    if (!data.length) break;
    repos.push(...data);
    page++;
  }
  return repos;
}

async function getPackageJson(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`, { headers });
  if (res.status !== 200) return null;
  const content = await res.json();
  const buff = Buffer.from(content.content, 'base64');
  return JSON.parse(buff.toString());
}

async function getReferenceVersion() {
  const pkg = await getPackageJson('nhsuk', 'nhsuk-prototype-kit');
  return pkg?.version || null;
}

function generateHTML(results, referenceVersion) {
  const rows = results.map(r => `
    <tr>
      <td><a href="${r.url}" target="_blank">${r.name}</a></td>
      <td>${r.version || '-'}</td>
      <td>${r.status}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>NHSUK Prototype Kit Versions</title>
      <style>
        body { font-family: Arial; padding: 2em; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background: #eee; }
      </style>
    </head>
    <body>
      <h1>NHSUK Prototype Kit Version Report</h1>
      <p>Reference version: <strong>${referenceVersion}</strong></p>
      <table>
        <tr><th>Repository</th><th>Version</th><th>Status</th></tr>
        ${rows}
      </table>
    </body>
    </html>
  `;
}

async function main() {
  const repos = await getRepos(ORG);
  const referenceVersion = await getReferenceVersion();
  const results = [];

  for (const repo of repos) {
    const pkg = await getPackageJson(ORG, repo.name);
    if (!pkg || pkg.name !== 'nhsuk-prototype-kit') continue;

    let status = 'Up to date';
    if (pkg.version !== referenceVersion) {
      status = 'Outdated';
    }

    results.push({
      name: repo.name,
      url: repo.html_url,
      version: pkg.version,
      status,
    });
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const html = generateHTML(results, referenceVersion);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
