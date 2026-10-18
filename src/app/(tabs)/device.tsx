import { useTranslation } from 'react-i18next';

import { SourcePlaceholder } from '@/ui/components';

export default function DeviceScreen() {
  const { t } = useTranslation();
  return <SourcePlaceholder icon="chip" body={t('screens.device.placeholder')} />;
}
