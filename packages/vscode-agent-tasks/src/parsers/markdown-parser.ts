/**
 * Parsers for the agent artifact markdown files (task.md, plan.md, walkthrough.md)
 */

export interface TaskFrontmatter {
  created?: string;
  branch?: string;
  task?: string;
}

export interface TaskItem {
  label: string;
  completed: boolean;
  inProgress: boolean;
  children: TaskItem[];
}

export interface TaskDecision {
  decision: string;
  rationale: string;
  phase: string;
}

export interface TaskSection {
  heading: string;
  items: TaskItem[];
}

export interface ParsedTask {
  frontmatter: TaskFrontmatter;
  phase?: string;
  phaseName?: string;
  lastUpdated?: string;
  taskSections: TaskSection[];
  decisions: TaskDecision[];
  discoveries: string[];
  blockers: string[];
}

export interface PlanFrontmatter {
  created?: string;
  branch?: string;
  task?: string;
  approved?: boolean;
}

export interface ParsedPlan {
  frontmatter: PlanFrontmatter;
  summary?: string;
  goal?: string;
  filesToCreate: Array<{ file: string; purpose: string }>;
  filesToModify: Array<{ file: string; change: string }>;
  complexity?: string;
}

export interface WalkthroughFrontmatter {
  created?: string;
  branch?: string;
  task?: string;
  pr?: string;
}

export interface ParsedWalkthrough {
  frontmatter: WalkthroughFrontmatter;
  summary?: string;
  filesChanged: Array<{ file: string; change: string; purpose: string }>;
  branch?: string;
  pr?: string;
  worktreePath?: string;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

function extractSection(body: string, heading: string | string[]): string {
  const headings = Array.isArray(heading) ? heading : [heading];
  for (const h of headings) {
    // Match the heading line
    const headingRegex = new RegExp(`^## ${h}\\s*$`, 'm');
    const headingMatch = headingRegex.exec(body);
    if (!headingMatch) continue;

    // Find content start (after the heading line)
    const contentStart = body.indexOf('\n', headingMatch.index);
    if (contentStart === -1) return '';

    const remainder = body.slice(contentStart + 1);

    // Find the next ## heading (if any)
    const nextHeadingMatch = remainder.match(/^## /m);
    if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
      return remainder.slice(0, nextHeadingMatch.index).trim();
    }
    return remainder.trim();
  }
  return '';
}

function parseCheckboxItems(section: string): TaskItem[] {
  const rootItems: TaskItem[] = [];
  const stack: { indent: number; item: TaskItem }[] = [];
  const lines = section.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)/);
    if (!match) continue;

    const indent = match[1].length;
    const completed = match[2].toLowerCase() === 'x';
    let label = match[3].trim();
    const inProgress = label.includes('**IN PROGRESS**') || label.includes('<- **IN PROGRESS**');
    label = label
      .replace(/<-\s*\*\*IN PROGRESS\*\*/, '')
      .replace(/\*\*IN PROGRESS\*\*/, '')
      .trim();

    const item: TaskItem = { label, completed, inProgress, children: [] };

    // Pop stack entries that are at the same or deeper indent level
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootItems.push(item);
    } else {
      stack[stack.length - 1].item.children.push(item);
    }

    stack.push({ indent, item });
  }

  return rootItems;
}

function parseTableRows(section: string, columnCount: number): string[][] {
  const rows: string[][] = [];
  const lines = section.split('\n');
  let headerPassed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    // Skip separator row
    if (trimmed.match(/^\|[\s-|]+\|$/)) {
      headerPassed = true;
      continue;
    }

    // Skip header row
    if (!headerPassed) {
      headerPassed = false;
      continue;
    }

    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());

    if (cells.length >= columnCount && cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }
  return rows;
}

/**
 * Headings that are parsed separately (not as checkbox task sections).
 * Matched case-insensitively.
 */
const NON_TASK_HEADINGS = new Set(
  [
    'status',
    'decisions log',
    'decisions',
    'key findings',
    'discoveries',
    'notes',
    'blockers',
    'current blockers',
    'objective',
    'summary',
    'test iterations',
  ].map((h) => h.toLowerCase())
);

/**
 * Known heading synonyms mapped to a sort priority.
 * Lower number = higher in the tree. Matched case-insensitively.
 * Unknown headings get priority Infinity (appear after known ones, in markdown order).
 */
const HEADING_PRIORITY: Record<string, number> = {
  // "Current / In Progress" group — shown first
  current: 0,
  'in progress': 0,
  active: 0,
  'working on': 0,

  // "Completed / Done" group — shown second
  completed: 1,
  'completed items': 1,
  done: 1,
  finished: 1,

  // "Upcoming / TODO" group — shown third
  upcoming: 2,
  todo: 2,
  'to do': 2,
  planned: 2,
  next: 2,
  remaining: 2,
  backlog: 2,

  // Checklists — shown after the big three
  checklist: 3,
  tasks: 3,
  'task list': 3,
  'open questions': 3,
  'open questions (blocking)': 3,
  questions: 3,
};

function getHeadingPriority(heading: string): number {
  return HEADING_PRIORITY[heading.toLowerCase()] ?? Infinity;
}

/**
 * Extract all ## sections from the markdown body.
 * Returns sections in document order with their heading text and content.
 */
function extractAllSections(body: string): Array<{ heading: string; content: string; index: number }> {
  const sections: Array<{ heading: string; content: string; index: number }> = [];
  const headingRegex = /^## (.+)$/gm;
  const matches: Array<{ heading: string; start: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(body)) !== null) {
    matches.push({ heading: m[1].trim(), start: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const contentStart = body.indexOf('\n', matches[i].start);
    if (contentStart === -1) {
      sections.push({ heading: matches[i].heading, content: '', index: i });
      continue;
    }

    const contentEnd = i + 1 < matches.length ? body.lastIndexOf('\n', matches[i + 1].start) : body.length;
    const content = body.slice(contentStart + 1, contentEnd).trim();
    sections.push({ heading: matches[i].heading, content, index: i });
  }

  return sections;
}

/**
 * Check if a section's content contains any markdown checkboxes.
 */
function hasCheckboxes(content: string): boolean {
  return /^\s*[-*]\s+\[([ xX])\]/m.test(content);
}

export function parseTaskMd(content: string): ParsedTask {
  const { frontmatter, body } = parseFrontmatter(content);

  // Try to extract task name from title if not in frontmatter
  if (!frontmatter.task) {
    const titleMatch = body.match(/^#\s+Task:\s*(.+)/m);
    if (titleMatch) {
      frontmatter.task = titleMatch[1].trim();
    }
  }

  const statusSection = extractSection(body, 'Status');
  let phase: string | undefined;
  let phaseName: string | undefined;
  let lastUpdated: string | undefined;

  // Support both "**Phase**: N (Name)" and "Phase N: Name" formats
  const phaseMatch = statusSection.match(/\*\*Phase\*\*:\s*(\d+)\s*\(([^)]+)\)/);
  if (phaseMatch) {
    phase = phaseMatch[1];
    phaseName = phaseMatch[2];
  } else {
    const altPhaseMatch = statusSection.match(/Phase\s*(\d+):\s*(.+)/);
    if (altPhaseMatch) {
      phase = altPhaseMatch[1];
      phaseName = altPhaseMatch[2].trim();
    }
  }

  const updatedMatch = statusSection.match(/\*\*Last Updated\*\*:\s*(.+)/);
  if (updatedMatch) {
    lastUpdated = updatedMatch[1].trim();
  }

  // Parse dedicated non-task sections
  const decisionsSection = extractSection(body, ['Decisions Log', 'Decisions', 'Key Findings']);
  const discoveriesSection = extractSection(body, ['Discoveries', 'Notes']);
  const blockersSection = extractSection(body, ['Blockers', 'Current Blockers']);

  const decisions: TaskDecision[] = [];
  const decisionRows = parseTableRows(decisionsSection, 3);
  for (const row of decisionRows) {
    decisions.push({
      decision: row[0],
      rationale: row[1],
      phase: row[2],
    });
  }

  const discoveries = discoveriesSection
    .split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map((l) => l.replace(/^[-*]\s+/, '').trim());

  const blockerLines = blockersSection.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith('<!--'));
  const blockers =
    blockerLines.length === 1 && blockerLines[0].trim().toLowerCase() === 'none'
      ? []
      : blockerLines.filter((l) => l.trim().toLowerCase() !== 'none').map((l) => l.replace(/^[-*]\s+/, '').trim());

  // Scan all ## sections for checkbox content
  const allSections = extractAllSections(body);
  const taskSections: TaskSection[] = [];

  for (const section of allSections) {
    // Skip non-task sections (parsed separately above)
    if (NON_TASK_HEADINGS.has(section.heading.toLowerCase())) continue;

    // Only include sections that contain checkboxes
    if (!hasCheckboxes(section.content)) continue;

    const items = parseCheckboxItems(section.content);
    if (items.length > 0) {
      taskSections.push({ heading: section.heading, items });
    }
  }

  // Sort: known headings by priority, then unknown headings in markdown order
  taskSections.sort((a, b) => {
    const pa = getHeadingPriority(a.heading);
    const pb = getHeadingPriority(b.heading);
    if (pa !== pb) return pa - pb;
    // Same priority (or both unknown) — preserve markdown order
    const idxA = allSections.findIndex((s) => s.heading === a.heading);
    const idxB = allSections.findIndex((s) => s.heading === b.heading);
    return idxA - idxB;
  });

  return {
    frontmatter: frontmatter as TaskFrontmatter,
    phase,
    phaseName,
    lastUpdated,
    taskSections,
    decisions,
    discoveries,
    blockers,
  };
}

export function parsePlanMd(content: string): ParsedPlan {
  const { frontmatter, body } = parseFrontmatter(content);

  const summary = extractSection(body, 'Summary')
    .split('\n')
    .filter((l) => !l.trim().startsWith('<!--'))
    .join('\n')
    .trim();

  const goal = extractSection(body, 'Goal')
    .split('\n')
    .filter((l) => !l.trim().startsWith('<!--'))
    .join('\n')
    .trim();

  const createSection = extractSection(body, 'Files to Create');
  const modifySection = extractSection(body, 'Files to Modify');
  const complexitySection = extractSection(body, 'Estimated Complexity');

  const filesToCreate = parseTableRows(createSection, 2).map((r) => ({
    file: r[0],
    purpose: r[1],
  }));

  const filesToModify = parseTableRows(modifySection, 2).map((r) => ({
    file: r[0],
    change: r[1],
  }));

  const complexity = complexitySection
    .split('\n')
    .filter((l) => !l.trim().startsWith('<!--'))
    .join(' ')
    .trim();

  return {
    frontmatter: frontmatter as PlanFrontmatter,
    summary: summary || undefined,
    goal: goal || undefined,
    filesToCreate,
    filesToModify,
    complexity: complexity || undefined,
  };
}

export function parseWalkthroughMd(content: string): ParsedWalkthrough {
  const { frontmatter, body } = parseFrontmatter(content);

  const summary = extractSection(body, 'Summary')
    .split('\n')
    .filter((l) => !l.trim().startsWith('<!--'))
    .join('\n')
    .trim();

  const refSection = extractSection(body, 'Quick Reference');
  let branch: string | undefined;
  let pr: string | undefined;
  let worktreePath: string | undefined;

  const branchMatch = refSection.match(/\*\*Branch\*\*:\s*`([^`]+)`/);
  if (branchMatch) branch = branchMatch[1];

  const prMatch = refSection.match(/\*\*PR\*\*:\s*#?(\S+)/);
  if (prMatch) pr = prMatch[1];

  const wtMatch = refSection.match(/\*\*Worktree\*\*:\s*`([^`]+)`/);
  if (wtMatch) worktreePath = wtMatch[1];

  const changedSection = extractSection(body, 'Files Changed');
  const filesChanged = parseTableRows(changedSection, 3).map((r) => ({
    file: r[0],
    change: r[1],
    purpose: r[2],
  }));

  return {
    frontmatter: frontmatter as WalkthroughFrontmatter,
    summary: summary || undefined,
    filesChanged,
    branch,
    pr,
    worktreePath,
  };
}
