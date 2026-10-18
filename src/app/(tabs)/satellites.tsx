import { useTranslation } from 'react-i18next';

import { SourcePlaceholder } from '@/ui/components';

export default function SatellitesScreen() {
  const { t } = useTranslation();
  return <SourcePlaceholder icon="satellite-variant" body={t('screens.satellites.placeholder')} />;
}
