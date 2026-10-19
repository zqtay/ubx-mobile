import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  listUsbDevices,
  phoneNeedsPermissionPrompt,
  startSource,
  startUsbSource,
  stopSource,
  usbAvailability,
  watchUsbDevices,
  type SourceChoice,
} from '@/sources';
import { matchesRef } from '@/sources/usb/UsbSerialSource';
import { useGnssStore } from '@/state/gnssStore';
import { useSettings, type BaudSetting } from '@/state/settingsStore';
import { AppText, Button, Chip } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

import type { UsbSerialDevice } from '../../modules/usb-serial';

type Icon = ComponentProps<typeof MaterialCommunityIcons>['name'];

const BAUDS: BaudSetting[] = ['auto', 9600, 38400, 57600, 115200, 230400, 460800, 921600];

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** Receiver picker (functional spec §2), presented as a bottom sheet. */
export default function SourceSheet() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const active = useGnssStore((s) => s.source);
  const lastSource = useSettings((s) => s.lastSource);
  const lastUsbDevice = useSettings((s) => s.lastUsbDevice);
  // The demo receiver is a development/test tool (implementation plan M2.1). E2E builds enable
  // it with EXPO_PUBLIC_DEMO_SOURCE=1.
  const showDemo = __DEV__ || process.env.EXPO_PUBLIC_DEMO_SOURCE === '1';

  const go = (choice: SourceChoice) => {
    router.back();
    void startSource(choice);
  };
  // Explain why location is needed before the system dialog appears (REQ-AND-01).
  const choosePhone = async () => {
    if (await phoneNeedsPermissionPrompt()) {
      Alert.alert(t('source.rationaleTitle'), t('source.rationaleBody'), [
        { text: t('source.cancel'), style: 'cancel' },
        { text: t('source.rationaleContinue'), onPress: () => go('phone') },
      ]);
      return;
    }
    go('phone');
  };
  const chooseUsb = (device: UsbSerialDevice) => {
    router.back();
    void startUsbSource(device);
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
      <SourceOption
        testID="source-phone"
        icon="cellphone"
        title={t('source.phone')}
        hint={t('source.phoneHint')}
        active={active !== null && lastSource === 'phone'}
        onPress={() => void choosePhone()}
      />
      <UsbSection
        activeRef={active !== null && lastSource === 'usb' ? lastUsbDevice : undefined}
        onChoose={chooseUsb}
      />
      {showDemo ? (
        <SourceOption
          testID="source-demo"
          icon="play-circle-outline"
          title={t('source.demo')}
          hint={t('source.demoHint')}
          active={active !== null && lastSource === 'demo'}
          onPress={() => go('demo')}
        />
      ) : null}
      {active ? (
        <Button variant="secondary" label={t('source.disconnect')} onPress={disconnect} />
      ) : null}
    </ScrollView>
  );
}

function SourceOption(props: {
  testID: string;
  icon: Icon;
  title: string;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <Pressable
      testID={props.testID}
      disabled={props.disabled || !props.onPress}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!props.disabled, selected: props.active }}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: colors.surface,
          borderColor: props.active ? colors.primary : colors.border,
          borderWidth: props.active ? 2 : StyleSheet.hairlineWidth,
          opacity: props.disabled ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}>
      <MaterialCommunityIcons name={props.icon} size={28} color={colors.primary} />
      <View style={styles.text}>
        <AppText variant="heading">{props.title}</AppText>
        <AppText variant="caption" muted>
          {props.hint}
        </AppText>
      </View>
      {props.active ? (
        <AppText variant="caption" color={colors.primary} style={styles.badge}>
          {t('source.active')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** USB devices, live-updated on attach/detach, plus the baud selector (functional spec §2). */
function UsbSection({
  activeRef,
  onChoose,
}: {
  activeRef?: { vendorId: number; productId: number; serialNumber?: string };
  onChoose: (device: UsbSerialDevice) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const availability = usbAvailability();
  const [devices, setDevices] = useState<UsbSerialDevice[]>([]);
  const baud = useSettings((s) => s.usb.defaultBaud);
  const updateUsb = useSettings((s) => s.updateUsb);

  const refresh = useCallback(() => {
    void listUsbDevices().then(setDevices);
  }, []);
  useEffect(() => {
    if (availability !== 'ok') return;
    refresh();
    return watchUsbDevices(refresh);
  }, [availability, refresh]);

  if (availability !== 'ok') {
    return (
      <SourceOption
        testID="source-usb"
        icon="usb"
        title={t('source.usb')}
        hint={
          availability === 'unsupported' ? t('source.usbUnsupported') : t('source.usbUnavailable')
        }
        active={false}
        disabled
      />
    );
  }

  return (
    <View testID="source-usb" style={styles.usb}>
      <View style={styles.usbHeader}>
        <MaterialCommunityIcons name="usb" size={28} color={colors.primary} />
        <View style={styles.text}>
          <AppText variant="heading">{t('source.usb')}</AppText>
          <AppText variant="caption" muted>
            {t('source.usbHint')}
          </AppText>
        </View>
      </View>
      {devices.length === 0 ? (
        <View
          style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <AppText variant="label">{t('source.usbNone')}</AppText>
          <AppText variant="caption" muted>
            {t('source.usbHelp')}
          </AppText>
        </View>
      ) : (
        <>
          {devices.map((d) => (
            <SourceOption
              key={d.deviceId}
              testID={`usb-device-${d.deviceId}`}
              icon={d.driver === 'cdc-acm' ? 'satellite-uplink' : 'serial-port'}
              title={d.productName ?? t('source.usbUnknownDevice')}
              hint={[
                `${hex(d.vendorId)}:${hex(d.productId)}`,
                d.driver.toUpperCase(),
                d.serialNumber,
              ]
                .filter(Boolean)
                .join(' · ')}
              active={activeRef !== undefined && matchesRef(d, activeRef)}
              onPress={() => onChoose(d)}
            />
          ))}
          <AppText variant="caption" muted>
            {t('source.adapterNote')}
          </AppText>
        </>
      )}
      <AppText variant="label" muted>
        {t('source.baud')}
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bauds}>
        {BAUDS.map((b) => (
          <Chip
            key={String(b)}
            testID={`baud-${b}`}
            label={b === 'auto' ? t('source.baudAuto') : String(b)}
            selected={baud === b}
            onPress={() => updateUsb({ defaultBaud: b })}
          />
        ))}
      </ScrollView>
      <AppText variant="caption" muted>
        {t('source.baudHint')}
      </AppText>
    </View>
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
  usb: {
    gap: spacing.sm,
  },
  usbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  empty: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bauds: {
    gap: spacing.sm,
  },
});
