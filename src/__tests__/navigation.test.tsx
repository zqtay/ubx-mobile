import { renderRouter, screen } from 'expo-router/testing-library';

describe('navigation', () => {
  it('opens on the Satellites tab (functional spec §1)', async () => {
    // A string context is resolved against the Jest root (the project directory).
    const result = await renderRouter('./src/app', { initialUrl: '/' });
    expect(result.getPathname()).toBe('/satellites');
    expect(screen.getByText('The satellite list will appear here.', { exact: false })).toBeTruthy();
  });
});
