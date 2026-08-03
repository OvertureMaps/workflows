// Entry point: fetch projects, plan the sync, apply (or log, in dry-run).
'use strict';

const { fetchProject, applyChange } = require('./projects.js');
const { buildPlan } = require('./plan.js');

module.exports = async function run({ github, core, org, projectNumbers, dryRun }) {
  const projects = await Promise.all(projectNumbers.map((n) => fetchProject(github, org, n)));

  for (const p of projects) {
    if (!p.statusField?.options?.length) {
      core.setFailed(`Project "${p.title}" (#${p.number}) has no Status single-select field.`);
      return;
    }
    core.info(`Project "${p.title}" (#${p.number}): ${p.items.length} items`);
  }

  const { changes, skipped } = buildPlan(projects);

  for (const s of skipped) {
    core.warning(
      `${s.ref}: project "${s.projectTitle}" has no Status option matching "${s.sourceStatus}", skipping.`
    );
  }

  for (const change of changes) {
    const action = dryRun ? 'would set' : 'setting';
    core.info(
      `${change.ref}: ${action} "${change.projectTitle}" status ` +
        `"${change.currentStatus ?? '(unset)'}" -> "${change.newStatus}" ` +
        `(source: "${change.sourceTitle}")`
    );
    if (!dryRun) {
      await applyChange(github, change);
    }
  }

  core.notice(
    `Done: ${changes.length + skipped.length} mismatches found, ` +
      `${changes.length} ${dryRun ? 'would be ' : ''}synced, ` +
      `${skipped.length} skipped (no matching option).`
  );
};
