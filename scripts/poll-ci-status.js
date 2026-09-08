/**
 * Polls the real GitHub Actions API for run 34046042516 and reports job statuses.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RUN_ID = '34046042516';
const REPO = 'Ryzen-hub-dev/valax-wearedevs-deobfuscator';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Valax-CI-Monitor/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

async function checkStatus() {
  const runUrl = `https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}`;
  const jobsUrl = `https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}/jobs`;

  const run = await fetchJson(runUrl);
  const jobsData = await fetchJson(jobsUrl);

  const jobs = (jobsData.jobs || []).map(j => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    started_at: j.started_at,
    completed_at: j.completed_at,
    steps: (j.steps || []).map(s => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion
    }))
  }));

  const summary = {
    runId: run.id,
    name: run.name,
    headSha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    totalJobs: jobs.length,
    jobs
  };

  const outPath = path.resolve(__dirname, '../audit/ci-live-status.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n=== GITHUB ACTIONS RUN ${RUN_ID} ===`);
  console.log(`Status: ${run.status} | Conclusion: ${run.conclusion}`);
  console.log(`Commit: ${run.head_sha}`);
  console.log('\n--- JOBS ---');
  for (const j of jobs) {
    console.log(`- ${j.name}: status=${j.status}, conclusion=${j.conclusion}`);
    if (j.status === 'in_progress' || j.conclusion === 'failure') {
      for (const s of j.steps) {
        if (s.status !== 'pending') {
          console.log(`    Step: ${s.name} [${s.status} / ${s.conclusion}]`);
        }
      }
    }
  }

  return summary;
}

if (require.main === module) {
  checkStatus().catch(console.error);
}

module.exports = { checkStatus };
