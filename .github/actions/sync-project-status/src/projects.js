// GraphQL access for org ProjectsV2: fetching projects/items and applying
// status changes. All IO lives here; planning logic is in plan.js.
'use strict';

const PROJECT_QUERY = `
  query($org: String!, $number: Int!, $cursor: String) {
    organization(login: $org) {
      projectV2(number: $number) {
        id
        title
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isArchived
            content {
              ... on Issue { id number repository { nameWithOwner } }
              ... on PullRequest { id number repository { nameWithOwner } }
            }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
                updatedAt
              }
            }
          }
        }
      }
    }
  }`;

const UPDATE_STATUS_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) { clientMutationId }
  }`;

// Fetches a project's Status field and all non-archived issue/PR items with
// their current Status value and when it was last set.
async function fetchProject(github, org, number) {
  const project = { number, items: [] };
  let cursor = null;
  do {
    const result = await github.graphql(PROJECT_QUERY, { org, number, cursor });
    const p = result.organization.projectV2;
    project.id = p.id;
    project.title = p.title;
    project.statusField = p.field;
    project.items.push(...p.items.nodes.filter((n) => !n.isArchived && n.content?.id));
    cursor = p.items.pageInfo.hasNextPage ? p.items.pageInfo.endCursor : null;
  } while (cursor);
  return project;
}

// Applies a single planned status change.
async function applyChange(github, change) {
  await github.graphql(UPDATE_STATUS_MUTATION, {
    projectId: change.projectId,
    itemId: change.itemId,
    fieldId: change.fieldId,
    optionId: change.optionId,
  });
}

module.exports = { fetchProject, applyChange };
