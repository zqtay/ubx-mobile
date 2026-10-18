import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui/components';

export default function ConsoleScreen() {
  const { t } = useTranslation();
  return (
    <Screen scroll={false}>
      <EmptyState
        icon="console-line"
        title={t('screens.console.title')}
        body={t('screens.console.placeholder')}
      />
    </Screen>
  );
}
