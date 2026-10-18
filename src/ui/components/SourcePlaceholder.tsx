import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { EmptyState } from './EmptyState';
import { Screen } from './Screen';

export interface SourcePlaceholderProps {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** What this screen will show once a source is active. */
  body: string;
}

/**
 * "No source selected" state shared by the data screens (functional spec §1.1).
 * The action opens the Source sheet once it exists (M2/M3).
 */
export function SourcePlaceholder({ icon, body }: SourcePlaceholderProps) {
  const { t } = useTranslation();
  return (
    <Screen scroll={false}>
      <EmptyState
        icon={icon}
        title={t('source.chooseTitle')}
        body={`${body}\n${t('source.chooseBody')}`}
        actionLabel={t('source.chooseAction')}
        onAction={() => Alert.alert(t('source.chooseTitle'), t('source.comingSoon'))}
      />
    </Screen>
  );
}
