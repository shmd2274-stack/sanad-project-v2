import { normalizeArabic, uniqueStrings } from '../../text/arabic';
import { findSkills } from '../skills-taxonomy';
import { arDigits, BULLET } from './experience';
import { cleanItem, splitList } from './skills-extract';

/** Projects and certificates, read the way an ATS stores them. */
export interface ProjectItem { name: string; tools: string[]; description: string }
export interface CertificationItem { name: string; issuer: string; year: string | null }

const SENTENCE_END = /[.!?؟]$/;
const SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'on', 'to', 'with', 'a', 'an', 'by', 'from', 'using']);
function titleCaseRatio(text: string): number {
  const words = text.split(/\s+/).map(word => word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')).filter(word => /[A-Za-z]/.test(word) && !SMALL.has(word.toLowerCase()));
  return words.length ? words.filter(word => /^[A-Z]/.test(word)).length / words.length : 0;
}

/** «AI Therapeutic App (Rakeez), OpenAI API(GPT-4), Python, Flutter» → a project header (name + tools). */
function isProjectHeader(line: string): boolean {
  if (BULLET.test(line) || SENTENCE_END.test(line) || /^[a-z]/.test(line) || line.length > 170) return false;
  const name = splitList(line, /[,،|]/)[0] ?? line;
  if (/[ء-ي]/.test(name)) return name.split(/\s+/).length <= 10;
  return titleCaseRatio(name) >= 0.5 && name.split(/\s+/).length <= 14;
}

/** Tools as skills: known ones by their skill name, others as written when they look like a tool name. */
export function toolSkills(tools: string[]): string[] {
  return uniqueStrings(tools.flatMap(tool => {
    const known = findSkills(tool);
    if (known.length) return known;
    const value = cleanItem(tool);
    return value && value.split(/\s+/).length <= 3 && /^[A-Zء-ي]/.test(value) ? [value] : [];
  }));
}

export function parseProjects(lines: string[]): ProjectItem[] {
  const projects: ProjectItem[] = [];
  let current: ProjectItem | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isProjectHeader(line)) {
      let parts = splitList(line, /[,،]/).map(part => part.trim()).filter(Boolean);
      if (parts.length === 1 && / \| /.test(line)) parts = line.split(/\s+\|\s+/);
      current = { name: cleanItem(parts[0] ?? line), tools: parts.slice(1).map(cleanItem).filter(Boolean), description: '' };
      projects.push(current);
      continue;
    }
    if (!current) continue;
    const text = line.replace(BULLET, '');
    current.description = current.description ? `${current.description} ${text}` : text;
  }
  return projects.filter(project => project.name.length >= 3).slice(0, 8)
    .map(project => ({ ...project, description: project.description.length > 220 ? `${project.description.slice(0, 217).replace(/\s\S*$/, '')}…` : project.description }));
}

/** «• Azure AI Fundamentals (AI-900) – Microsoft • SQL Server – Tuwaiq Academy» → two certificates. */
export function parseCertifications(lines: string[]): CertificationItem[] {
  const out: CertificationItem[] = [];
  for (const line of lines) {
    for (const piece of line.split(/\s*[•▪●]\s*|\s+\|\s+/)) {
      const item = piece.replace(BULLET, '').trim();
      if (item.length < 4) continue;
      const year = /(?:19|20)\d{2}/.exec(item)?.[0] ?? null;
      const text = item.replace(/[([]?\s*(?:19|20)\d{2}\s*[)\]]?/g, ' ').replace(/\s+/g, ' ').replace(/[\s,،\-–—]+$/, '').trim();
      const parts = text.split(/\s+[–—-]\s+/);
      const last = parts[parts.length - 1]!;
      const hasIssuer = parts.length >= 2 && last.split(/\s+/).length <= 5;
      const name = hasIssuer ? parts.slice(0, -1).join(' – ') : text;
      if (name.length < 3) continue;
      out.push({ name, issuer: hasIssuer ? last : '', year });
    }
  }
  const seen = new Set<string>();
  return out.filter(item => { const id = normalizeArabic(item.name); if (seen.has(id)) return false; seen.add(id); return true; }).slice(0, 12);
}

export const formatCertification = (item: CertificationItem) => [item.name, item.issuer, item.year ? arDigits(item.year) : ''].filter(Boolean).join(' · ');
