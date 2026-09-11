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
    await github.rest.orgs.checkMembershipForUser({ org, username });
    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}
