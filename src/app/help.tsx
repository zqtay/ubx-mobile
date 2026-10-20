import { useTranslation } from 'react-i18next';

import { AppText, Card, Screen } from '@/ui/components';

const TOPICS = ['otg', 'wiring', 'power', 'baud', 'fc', 'phone', 'noData', 'config'] as const;

/** In-app help (M7.4): OTG, wiring, power, baud rate and troubleshooting. */
export default function HelpScreen() {
  const { t } = useTranslation();
  return (
    <Screen stackPage>
      {TOPICS.map((topic) => (
        <Card key={topic} title={t(`help.${topic}.title`)}>
          {t(`help.${topic}.body`, { returnObjects: true }).map((paragraph: string, i: number) => (
            <AppText key={i} muted>
              {paragraph}
            </AppText>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
