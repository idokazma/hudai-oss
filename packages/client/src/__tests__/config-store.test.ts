import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore } from '../stores/config-store.js';

describe('useConfigStore', () => {
  beforeEach(() => {
    useConfigStore.getState().clear();
  });

  it('addSuggestion adds a suggestion', () => {
    useConfigStore.getState().addSuggestion({
      tool: 'Read',
      promptCount: 5,
      suggestedRule: 'Read',
    });
    expect(useConfigStore.getState().suggestions).toHaveLength(1);
  });

  it('addSuggestion deduplicates by tool name', () => {
    useConfigStore.getState().addSuggestion({
      tool: 'Read',
      promptCount: 3,
      suggestedRule: 'Read',
    });
    useConfigStore.getState().addSuggestion({
      tool: 'Read',
      promptCount: 5,
      suggestedRule: 'Read',
    });
    const suggestions = useConfigStore.getState().suggestions;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].promptCount).toBe(5); // replaced with newer
  });

  it('dismissSuggestion removes by tool', () => {
    useConfigStore.getState().addSuggestion({
      tool: 'Read',
      promptCount: 3,
      suggestedRule: 'Read',
    });
    useConfigStore.getState().addSuggestion({
      tool: 'Write',
      promptCount: 4,
      suggestedRule: 'Write',
    });
    useConfigStore.getState().dismissSuggestion('Read');
    const suggestions = useConfigStore.getState().suggestions;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].tool).toBe('Write');
  });
});
