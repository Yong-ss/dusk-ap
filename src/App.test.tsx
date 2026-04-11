import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('renders Dusk text', () => {
  render(<App />);
  const linkElement = screen.getByText(/Dusk/i);
  expect(linkElement).toBeDefined();
});
