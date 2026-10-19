import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/ui/theme/tokens';

/**
 * Bottom padding for scrolling content on full-screen (stack) pages. Android draws edge to edge,
 * so without it the last items sit under the system navigation bar. Pass `covered` when a bar
 * that already handles the inset (e.g. the staged-changes bar) is shown below the content.
 */
export function useBottomInset(covered = false): number {
  const insets = useSafeAreaInsets();
  return spacing.lg + (covered ? 0 : insets.bottom);
}
