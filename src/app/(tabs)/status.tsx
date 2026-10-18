import { useTranslation } from 'react-i18next';

import { SourcePlaceholder } from '@/ui/components';

export default function StatusScreen() {
  const { t } = useTranslation();
  return <SourcePlaceholder icon="crosshairs-gps" body={t('screens.status.placeholder')} />;
}
