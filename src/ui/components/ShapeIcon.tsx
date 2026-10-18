import Svg, { Path } from 'react-native-svg';

import { constellationMeta, type MarkerShape } from '@/domain/constellations';
import type { Constellation } from '@/domain/types';
import { shapePath } from '@/ui/sky/shapes';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

export interface ShapeIconProps {
  shape: MarkerShape;
  fill: string;
  size?: number;
  stroke?: string;
  strokeWidth?: number;
}

/** A single marker shape, used in badges and the legend. */
export function ShapeIcon({ shape, fill, size = 14, stroke, strokeWidth = 0 }: ShapeIconProps) {
  const r = size / 2 - Math.max(1, strokeWidth);
  return (
    <Svg
      width={size}
      height={size}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Path
        d={shapePath(shape, size / 2, size / 2, r)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}

/** Constellation identity: shape in the constellation colour (functional spec §6.2). */
export function ConstellationBadge({
  constellation,
  size = 14,
}: {
  constellation: Constellation;
  size?: number;
}) {
  const { colors } = useAppTheme();
  const meta = constellationMeta(constellation);
  return <ShapeIcon shape={meta.shape} fill={colors.gnss[meta.color]} size={size} />;
}
