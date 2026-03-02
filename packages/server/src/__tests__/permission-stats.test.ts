import { describe, it, expect } from 'vitest';
import { PermissionStats } from '../config/permission-stats.js';

describe('PermissionStats', () => {
  it('returns no suggestions below threshold', () => {
    const stats = new PermissionStats();
    stats.recordPrompt('Read');
    stats.recordPrompt('Read');
    expect(stats.getNewSuggestions()).toEqual([]);
  });

  it('returns suggestion at threshold (3 prompts)', () => {
    const stats = new PermissionStats();
    stats.recordPrompt('Read');
    stats.recordPrompt('Read');
    stats.recordPrompt('Read');
    const suggestions = stats.getNewSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].tool).toBe('Read');
    expect(suggestions[0].promptCount).toBe(3);
    expect(suggestions[0].suggestedRule).toBe('Read');
  });

  it('suggests same tool only once', () => {
    const stats = new PermissionStats();
    for (let i = 0; i < 5; i++) stats.recordPrompt('Bash');
    expect(stats.getNewSuggestions()).toHaveLength(1);
    // Second call — already suggested
    expect(stats.getNewSuggestions()).toHaveLength(0);
  });

  it('tracks multiple tools independently', () => {
    const stats = new PermissionStats();
    for (let i = 0; i < 3; i++) stats.recordPrompt('Read');
    for (let i = 0; i < 3; i++) stats.recordPrompt('Write');
    stats.recordPrompt('Edit'); // only 1
    const suggestions = stats.getNewSuggestions();
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.tool).sort()).toEqual(['Read', 'Write']);
  });

  it('clear resets everything', () => {
    const stats = new PermissionStats();
    for (let i = 0; i < 5; i++) stats.recordPrompt('Bash');
    stats.getNewSuggestions(); // marks as suggested
    stats.clear();
    // After clear, new prompts should be tracked fresh
    for (let i = 0; i < 3; i++) stats.recordPrompt('Bash');
    expect(stats.getNewSuggestions()).toHaveLength(1);
  });
});
