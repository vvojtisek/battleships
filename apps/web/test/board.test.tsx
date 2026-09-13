// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from '../src/components/Board.js';

describe('Board', () => {
  it('fires the selected cell and moves keyboard focus through the grid', () => {
    const onCell = vi.fn();
    render(<Board hits={0n} label="Target board" onCell={onCell} shots={0n} />);

    const first = screen.getByRole('button', { name: 'A1, unknown' });
    fireEvent.click(first);
    expect(onCell).toHaveBeenCalledWith(0);

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'B1, unknown' }));
  });
});
