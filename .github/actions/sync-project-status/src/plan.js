// Pure planning logic: given fetched projects, compute the status changes
// needed to bring shared items in sync. No IO here, so it's unit-testable.
'use strict';

// Groups project items by their issue/PR node ID.
function groupByContent(projects) {
  const byContent = new Map();
  for (const project of projects) {
    for (const item of project.items) {
      const entry = byContent.get(item.content.id) ?? { content: item.content, items: [] };
      entry.items.push({ project, item });
      byContent.set(item.content.id, entry);
    }
  }
  return byContent;
}

// Picks the sync source for one shared item: the project entry whose Status
// was updated most recently. Returns null when no project has a status set.
function pickSource(entries) {
  return (
    entries
      .filter((e) => e.item.fieldValueByName?.updatedAt)
      .sort(
        (a, b) =>
          new Date(b.item.fieldValueByName.updatedAt) - new Date(a.item.fieldValueByName.updatedAt)
      )[0] ?? null
  );
}

// Computes the changes needed to sync statuses across projects.
// Returns { changes, skipped } where changes are ready to apply and skipped
// are mismatches with no matching Status option in the target project.
function buildPlan(projects) {
  const changes = [];
  const skipped = [];

  for (const { content, items } of groupByContent(projects).values()) {
    if (items.length < 2) continue;

    const source = pickSource(items);
    if (!source) continue;

    const sourceStatus = source.item.fieldValueByName.name;
    const ref = `${content.repository.nameWithOwner}#${content.number}`;

    for (const target of items) {
      if (target === source) continue;
      const current = target.item.fieldValueByName?.name;
      if (current?.toLowerCase() === sourceStatus.toLowerCase()) continue;

      const option = target.project.statusField.options.find(
        (o) => o.name.toLowerCase() === sourceStatus.toLowerCase()
      );
      const base = {
        ref,
        projectTitle: target.project.title,
        sourceTitle: source.project.title,
        currentStatus: current ?? null,
        sourceStatus,
      };
      if (!option) {
        skipped.push(base);
        continue;
      }
      changes.push({
        ...base,
        newStatus: option.name,
        projectId: target.project.id,
        itemId: target.item.id,
        fieldId: target.project.statusField.id,
        optionId: option.id,
      });
    }
  }

  return { changes, skipped };
}

module.exports = { buildPlan, groupByContent, pickSource };
