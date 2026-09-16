// Entry point: find recently-opened org issues from non-members and label them.
'use strict';

// Matches "https://api.github.com/repos/{owner}/{repo}" from a search result's repository_url.
const REPO_URL_RE = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/;

module.exports = async function run({ github, core, org, label, sinceIso, dryRun }) {
  const query = `org:${org} is:issue is:open -label:"${label}" created:>=${sinceIso}`;
  const issues = await github.paginate(github.rest.search.issuesAndPullRequests, {
    q: query,
    per_page: 100,
  });

  core.info(`Found ${issues.length} open, unlabeled issue(s) created since ${sinceIso}.`);

  let labeled = 0;
  let skippedMembers = 0;
  let skippedBots = 0;
  const ensuredLabelRepos = new Set(); // `${owner}/${repo}` already checked/created this run

  for (const issue of issues) {
    const match = issue.repository_url.match(REPO_URL_RE);
    if (!match) {
      core.warning(`Couldn't parse owner/repo from ${issue.repository_url}, skipping #${issue.number}.`);
      continue;
    }
    const [, owner, repo] = match;
    const author = issue.user?.login;
    const ref = `${owner}/${repo}#${issue.number}`;

    if (!author || issue.user.type === 'Bot') {
      skippedBots++;
      continue;
    }

    const isMember = await checkMembership(github, org, author);
    if (isMember) {
      skippedMembers++;
      continue;
    }

    const action = dryRun ? 'would label' : 'labeling';
    core.info(`${ref}: ${action} as "${label}" (author "${author}" is not an org member).`);
    if (!dryRun) {
      await ensureLabelExists(github, core, owner, repo, label, ensuredLabelRepos);
      await github.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels: [label] });
    }
    labeled++;
  }

  core.notice(
    `Done: ${labeled} ${dryRun ? 'would be ' : ''}labeled, ` +
      `${skippedMembers} skipped (org members), ${skippedBots} skipped (bots).`
  );
};

// Returns true if `username` is a member of `org`, false if not. Membership is
// only visible with an org-scoped read permission; the caller's app must have it.
async function checkMembership(github, org, username) {
  try {
    const response = await github.rest.orgs.checkMembershipForUser({ org, username });
    // 204 is the only "is a member" response; treat anything else (e.g. a
    // 302 for a pending invitation) as not-yet-a-member rather than member.
    return response.status === 204;
  } catch (error) {
    if (error.status === 404 || error.status === 302) {
      return false;
    }
    throw error;
  }
}

// Creates `label` in `owner/repo` if it doesn't already exist, so a fresh
// target repo doesn't need manual label setup before this action can run.
// Checked at most once per repo per run via `ensuredLabelRepos`.
async function ensureLabelExists(github, core, owner, repo, label, ensuredLabelRepos) {
  const key = `${owner}/${repo}`;
  if (ensuredLabelRepos.has(key)) {
    return;
  }
  ensuredLabelRepos.add(key);

  try {
    await github.rest.issues.getLabel({ owner, repo, name: label });
    return;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  try {
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: label,
      color: 'ededed',
      description: 'Opened by a user who is not a member of the organization',
    });
    core.info(`${owner}/${repo}: created missing "${label}" label.`);
  } catch (error) {
    // Another concurrent run may have created it between the check and here.
    if (error.status !== 422) {
      throw error;
    }
  }
}
