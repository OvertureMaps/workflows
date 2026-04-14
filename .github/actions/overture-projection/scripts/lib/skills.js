/**
 * @file lib/skills.js
 * @description SKILL.md frontmatter parsing and surface filtering.
 *
 * Used by load-skills.js. Extracted for unit-testability — the regex logic
 * in parseFrontmatter is non-trivial and benefits from isolated testing
 * against a variety of frontmatter shapes.
 */

'use strict';

/**
 * @typedef {Object} FrontmatterResult
 * @property {string}        description  - Human-readable description used for skill selection.
 * @property {string[]}      contextFiles - List of `owner/repo:path` context-file refs.
 * @property {string[]|null} surfaces     - Surfaces the skill targets, or `null` if the field
 *                                          is absent (legacy pass-through behaviour).
 */

/**
 * Parses the YAML frontmatter block at the top of a SKILL.md file.
 *
 * Extracts three custom fields used by the pr-reviewer pipeline:
 * - `description`    — plain-text summary passed to the selection model. Handles
 *                      both inline (`description: foo`) and block scalar (`description: >\n  foo`)
 *                      forms; strips surrounding quotes if present.
 * - `context-files`  — YAML list of cross-repo `owner/repo:path` refs to inject into the prompt.
 * - `surfaces`       — inline bracket-list (e.g. `[pr-reviewer, agent]`) declaring which
 *                      surfaces the skill targets.
 *
 * A missing `surfaces` field returns `null` (not an empty array) so callers can
 * distinguish "no field present" (legacy pass-through) from "explicitly empty list".
 *
 * @param {string} raw - Full SKILL.md file content including frontmatter.
 * @returns {FrontmatterResult}
 *
 * @example
 * parseFrontmatter('---\ndescription: Checks containers\nsurfaces: [pr-reviewer]\n---\n# Body')
 * // => { description: 'Checks containers', contextFiles: [], surfaces: ['pr-reviewer'] }
 */
function parseFrontmatter(raw) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return { description: '', contextFiles: [], surfaces: null };
  const fm = fmMatch[1];

  const descMatch = fm.match(/description:\s*[>|]?\s*\n?([\s\S]*?)(?=\n\w|$)/);
  const description = descMatch
    ? descMatch[1].replace(/\n\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '')
    : '';

  const cfSection = fm.match(/^context-files:\s*\n((?:\s*-\s*.+\n?)*)/m);
  const contextFiles = cfSection
    ? [...cfSection[1].matchAll(/^\s*-\s*(.+)$/gm)].map(m => m[1].trim())
    : [];

  // null means no surfaces field — skill passes through unfiltered (legacy default)
  const surfacesMatch = fm.match(/^surfaces:\s*\[([^\]]*)\]/m);
  const surfaces = surfacesMatch
    ? surfacesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    : null;

  return { description, contextFiles, surfaces };
}

/**
 * @typedef {Object} RawSkill
 * @property {string} name - Skill folder name (skill ID).
 * @property {string} raw  - Full SKILL.md content including frontmatter.
 */

/**
 * @typedef {Object} Skill
 * @property {string}   name         - Skill folder name, used as the skill ID.
 * @property {string}   description  - Frontmatter description for the selection model.
 * @property {string[]} contextFiles - Context-file refs (`owner/repo:path`) to fetch post-selection.
 * @property {string}   raw          - Full raw SKILL.md content (frontmatter + body).
 */

/**
 * Filters an array of raw skills to those targeting the `pr-reviewer` surface,
 * then maps each to a {@link Skill} object by parsing their frontmatter.
 *
 * Skills with no `surfaces` field are included unconditionally (legacy
 * pass-through). Skills whose `surfaces` list does not include `pr-reviewer`
 * are excluded.
 *
 * @param {RawSkill[]} rawSkills - Skills read from disk before any filtering.
 * @returns {Skill[]} Skills that should be considered by the pr-reviewer pipeline.
 *
 * @example
 * filterSkills([
 *   { name: 'a', raw: '---\nsurfaces: [pr-reviewer]\n---' },
 *   { name: 'b', raw: '---\nsurfaces: [agent]\n---' },
 *   { name: 'c', raw: '# no frontmatter' },
 * ])
 * // => [{ name: 'a', ... }, { name: 'c', ... }]  — 'b' is excluded
 */
function filterSkills(rawSkills) {
  return rawSkills
    .filter(s => {
      const { surfaces } = parseFrontmatter(s.raw);
      if (surfaces === null) return true;
      return surfaces.includes('pr-reviewer');
    })
    .map(({ name, raw }) => {
      const { description, contextFiles } = parseFrontmatter(raw);
      return { name, description, contextFiles, raw };
    });
}

module.exports = { parseFrontmatter, filterSkills };
