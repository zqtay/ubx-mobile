import { Text, type TextProps } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { typography, type TypographyVariant } from '@/ui/theme/tokens';

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  muted?: boolean;
  color?: string;
};

export function AppText({ variant = 'body', muted, color, style, ...rest }: AppTextProps) {
  const { colors } = useAppTheme();
  return (
    <Text
      style={[
        typography[variant],
        { color: color ?? (muted ? colors.textMuted : colors.text) },
        style,
      ]}
      {...rest}
    />
  );
}
