import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export type ContentDoc = {
  slug: string;
  title: string;
  description: string;
  content: string;
};

const contentDir = path.join(process.cwd(), 'src/content');

export function getContentDoc(slug: string): ContentDoc | null {
  const filePath = path.join(contentDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  return {
    slug,
    title: typeof data.title === 'string' ? data.title : slug,
    description: typeof data.description === 'string' ? data.description : '',
    content,
  };
}
