import { describe, it, expect } from 'vitest';
import { formatDate, groupByDate, formatTime } from './utils';

describe('formatTime', () => {
  it('formats zero seconds', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds under a minute', () => {
    expect(formatTime(30)).toBe('0:30');
  });

  it('formats exactly one minute', () => {
    expect(formatTime(60)).toBe('1:00');
  });

  it('formats minutes with seconds', () => {
    expect(formatTime(125)).toBe('2:05');
  });

  it('formats large values', () => {
    expect(formatTime(3661)).toBe('61:01');
  });

  it('pads single digit seconds', () => {
    expect(formatTime(63)).toBe('1:03');
  });

  it('pads double digit seconds', () => {
    expect(formatTime(75)).toBe('1:15');
  });
});

describe('formatDate', () => {
  it('returns Today for current date', () => {
    const now = new Date().toISOString();
    expect(formatDate(now)).toBe('Today');
  });

  it('returns formatted date for old dates', () => {
    const old = '2020-01-15T10:00:00Z';
    const result = formatDate(old);
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not return Today for a date from yesterday last year', () => {
    const now = new Date();
    const old = new Date(now.getFullYear() - 1, 0, 1);
    const result = formatDate(old.toISOString());
    expect(result).not.toBe('Today');
  });
});

describe('groupByDate', () => {
  it('groups notes by date', () => {
    const today = new Date().toISOString();
    const notes = [
      { id: '1', date: today },
      { id: '2', date: today },
    ];
    const groups = groupByDate(notes);
    expect(groups['Today']).toBeDefined();
    expect(groups['Today'].length).toBe(2);
  });

  it('returns empty object for empty array', () => {
    const groups = groupByDate([]);
    expect(Object.keys(groups).length).toBe(0);
  });

  it('creates separate groups for different dates', () => {
    const today = new Date().toISOString();
    const old = '2020-06-15T10:00:00Z';
    const notes = [
      { id: '1', date: today },
      { id: '2', date: old },
      { id: '3', date: today },
      { id: '4', date: old },
    ];
    const groups = groupByDate(notes);
    expect(Object.keys(groups).length).toBe(2);
    expect(groups['Today'].length).toBe(2);
  });

  it('handles single note', () => {
    const notes = [{ id: '1', date: new Date().toISOString() }];
    const groups = groupByDate(notes);
    expect(groups['Today']).toBeDefined();
    expect(groups['Today'].length).toBe(1);
  });
});
