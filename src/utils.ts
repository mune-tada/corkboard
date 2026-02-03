import * as crypto from 'crypto';

/** UUID生成 */
export function generateId(): string {
  return crypto.randomUUID();
}

/** nonceの生成（CSP用） */
export function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/** YAMLフロントマターからsynopsis/description/summaryフィールドを抽出 */
export function extractFrontmatterSynopsis(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }
  const frontmatter = match[1];
  for (const key of ['synopsis', 'description', 'summary']) {
    const fieldMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (fieldMatch) {
      return fieldMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

/** ファイル先頭N行を取得（空行とフロントマターを除く） */
export function getFirstLines(content: string, count: number): string {
  let text = content;
  // フロントマターを除去
  const fmMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (fmMatch) {
    text = text.slice(fmMatch[0].length);
  }
  const lines = text.split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .slice(0, count);
  return lines.join('\n');
}
