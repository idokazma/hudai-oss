import type { PlanBlockStatus } from '@hudai/shared';
import { fonts } from '../../theme/tokens.js';

/**
 * Split a description string into bullet items.
 * Supports: newline-separated, sentence-separated (". "), or the whole string as one bullet.
 */
function toBullets(description: string): string[] {
  // If it already has line breaks, split on them
  const lines = description.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  // Otherwise split on sentence boundaries ("." followed by space + uppercase)
  const sentences = description.split(/\.\s+(?=[A-Z])/).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
  if (sentences.length > 1) return sentences;
  return [description];
}

export interface DescriptionBulletsProps {
  description: string;
  planStatus?: PlanBlockStatus;
  maxItems?: number;
}

export function DescriptionBullets({ description, planStatus, maxItems }: DescriptionBulletsProps) {
  const items = toBullets(description);
  const shown = maxItems ? items.slice(0, maxItems) : items;
  const isCompleted = planStatus === 'completed';

  return (
    <ul style={{
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      {shown.map((item, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            fontSize: 11,
            fontFamily: fonts.mono,
            color: '#7a8a9a',
            lineHeight: 1.4,
          }}
        >
          <span style={{
            flexShrink: 0,
            fontSize: 10,
            lineHeight: '16px',
            color: isCompleted ? '#52b788' : '#5a6a7a',
          }}>
            {isCompleted ? '☑' : '☐'}
          </span>
          <span style={{
            textDecoration: isCompleted ? 'line-through' : 'none',
            opacity: isCompleted ? 0.6 : 1,
          }}>
            {item}
          </span>
        </li>
      ))}
      {maxItems && items.length > maxItems && (
        <li style={{
          fontSize: 10,
          fontFamily: fonts.mono,
          color: '#5a6a7a',
          paddingLeft: 15,
        }}>
          +{items.length - maxItems} more
        </li>
      )}
    </ul>
  );
}
