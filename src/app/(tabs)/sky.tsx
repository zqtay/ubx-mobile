import { useTranslation } from 'react-i18next';

import { SourcePlaceholder } from '@/ui/components';

export default function SkyScreen() {
  const { t } = useTranslation();
  return <SourcePlaceholder icon="radar" body={t('screens.sky.placeholder')} />;
}
