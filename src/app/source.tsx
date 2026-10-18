import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { phoneNeedsPermissionPrompt, startSource, stopSource, type SourceChoice } from '@/sources';
import { useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';
import { AppText, Button } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

interface Option {
  choice: SourceChoice;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  titleKey: 'source.phone' | 'source.usb' | 'source.demo';
  hintKey: 'source.phoneHint' | 'source.usbHint' | 'source.demoHint';
  available: boolean;
}

const OPTIONS: Option[] = [
  {
    choice: 'phone',
    icon: 'cellphone',
    titleKey: 'source.phone',
    hintKey: 'source.phoneHint',
    available: true,
  },
  {
    choice: 'usb',
    icon: 'usb',
    titleKey: 'source.usb',
    hintKey: 'source.usbHint',
    available: false,
  },
  // The demo receiver is a development/test tool for now (implementation plan M2.1). E2E builds
  // enable it with EXPO_PUBLIC_DEMO_SOURCE=1.
  ...(__DEV__ || process.env.EXPO_PUBLIC_DEMO_SOURCE === '1'
    ? [
        {
          choice: 'demo',
          icon: 'play-circle-outline',
          titleKey: 'source.demo',
          hintKey: 'source.demoHint',
          available: true,
        } as const,
      ]
    : []),
];

/** Receiver picker (functional spec §2), presented as a bottom sheet. */
export default function SourceSheet() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const active = useGnssStore((s) => s.source);
  const lastSource = useSettings((s) => s.lastSource);

  const go = (choice: SourceChoice) => {
    router.back();
    void startSource(choice);
  };
  // Explain why location is needed before the system dialog appears (REQ-AND-01).
  const choose = async (choice: SourceChoice) => {
    if (choice === 'phone' && (await phoneNeedsPermissionPrompt())) {
      Alert.alert(t('source.rationaleTitle'), t('source.rationaleBody'), [
        { text: t('source.cancel'), style: 'cancel' },
        { text: t('source.rationaleContinue'), onPress: () => go(choice) },
      ]);
      return;
    }
    go(choice);
  };
  const disconnect = () => {
    router.back();
    void stopSource();
  };

  return (
    <ScrollView
      testID="source-sheet"
      contentContainerStyle={styles.content}
      style={{ backgroundColor: colors.bg }}>
      <AppText variant="title" accessibilityRole="header">
        {t('source.chooseTitle')}
      </AppText>
      {OPTIONS.map((o) => {
        const isActive = active !== null && lastSource === o.choice;
        return (
          <Pressable
            key={o.choice}
            testID={`source-${o.choice}`}
            disabled={!o.available}
            onPress={() => void choose(o.choice)}
            accessibilityRole="button"
            accessibilityState={{ disabled: !o.available, selected: isActive }}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: colors.surface,
                borderColor: isActive ? colors.primary : colors.border,
                borderWidth: isActive ? 2 : StyleSheet.hairlineWidth,
                opacity: !o.available ? 0.5 : pressed ? 0.75 : 1,
              },
            ]}>
            <MaterialCommunityIcons name={o.icon} size={28} color={colors.primary} />
            <View style={styles.text}>
              <AppText variant="heading">{t(o.titleKey)}</AppText>
              <AppText variant="caption" muted>
                {o.available ? t(o.hintKey) : `${t(o.hintKey)} · ${t('source.notYet')}`}
              </AppText>
            </View>
            {isActive ? (
              <AppText variant="caption" color={colors.primary} style={styles.badge}>
                {t('source.active')}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
      {active ? (
        <Button variant="secondary" label={t('source.disconnect')} onPress={disconnect} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    minHeight: minTouchTarget + spacing.lg,
    borderRadius: radius.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  badge: {
    fontWeight: '700',
  },
});
