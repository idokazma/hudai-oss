import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../parser/ansi-utils.js';

describe('stripAnsi', () => {
  it('removes basic color codes', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m')).toBe('hello');
  });

  it('removes multi-param SGR sequences', () => {
    expect(stripAnsi('\x1b[1;32mbold green\x1b[0m')).toBe('bold green');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('no ansi here')).toBe('no ansi here');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips multiple sequences in one string', () => {
    const input = '\x1b[34mblue\x1b[0m and \x1b[33myellow\x1b[0m';
    expect(stripAnsi(input)).toBe('blue and yellow');
  });

  it('strips sequences with no params', () => {
    expect(stripAnsi('\x1b[mtext')).toBe('text');
  });
});
