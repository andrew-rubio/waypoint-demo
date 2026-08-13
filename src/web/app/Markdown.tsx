'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

/**
 * Renders assistant replies as rich text (bold, lists, headings, code, links,
 * tables). react-markdown does NOT render raw HTML by default and we do not add
 * rehype-raw, so model output cannot inject markup — safe against XSS. Links are
 * forced to open in a new tab with noopener/noreferrer.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
