import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, Field, Progress } from './ui';
describe('accessible shared controls', () => {
  it('has non-submit default and real labeled inputs', () => {
    render(
      <>
        <Button>ذخیره</Button>
        <Field label="نام">
          <input />
        </Field>
      </>,
    );
    expect(screen.getByRole('button', { name: 'ذخیره' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('textbox', { name: 'نام' })).toBeInTheDocument();
  });
  it('clamps progress for over-target values', () => {
    render(<Progress value={150} max={100} label="آب" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
