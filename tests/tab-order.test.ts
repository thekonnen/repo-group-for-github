import { describe, expect, it } from 'vitest';
import { moveTab, nudgeTab, orderTabs } from '../src/core/tab-order';

describe('tab order', () => {
  const v = ['about', 'items', 'rules', 'all'];
  it('uses the built-in order when nothing is saved', () => expect(orderTabs(v, [])).toEqual(v));
  it('keeps the saved order and drops tabs that are not visible', () => {
    expect(orderTabs(v, ['all', 'members', 'items'])).toEqual(['all', 'items', 'about', 'rules']);
  });
  it('appends a tab that appears later and ignores duplicates', () => {
    expect(orderTabs(['items', 'about'], ['items', 'items'])).toEqual(['items', 'about']);
  });
  it('moves before another tab or to the end', () => {
    expect(moveTab(v, 'about', 'rules')).toEqual(['items', 'about', 'rules', 'all']);
    expect(moveTab(v, 'about', null)).toEqual(['items', 'rules', 'all', 'about']);
    expect(moveTab(v, 'zzz', 'items')).toBe(v);
  });
  it('nudges one step and stops at the edges', () => {
    expect(nudgeTab(v, 'items', -1)).toEqual(['items', 'about', 'rules', 'all']);
    expect(nudgeTab(v, 'about', -1)).toBe(v);
    expect(nudgeTab(v, 'all', 1)).toBe(v);
  });
});
