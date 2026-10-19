import { fireEvent, render, screen } from '@testing-library/react-native';

import { StyleSheet, Text } from 'react-native';

import { Banner } from '../Banner';
import { Card } from '../Card';
import { formatValue, KeyValueRow, NOT_AVAILABLE } from '../KeyValueRow';
import { SegmentedControl } from '../SegmentedControl';
import { StatusChip } from '../StatusChip';

describe('formatValue (REQ-SAT-05)', () => {
  it('shows a dash for unavailable values', () => {
    expect(formatValue(undefined)).toBe(NOT_AVAILABLE);
    expect(formatValue(null)).toBe(NOT_AVAILABLE);
    expect(formatValue('')).toBe(NOT_AVAILABLE);
  });

  it('shows a real zero instead of a dash', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(0, 'dB-Hz')).toBe('0 dB-Hz');
  });
});

describe('KeyValueRow', () => {
  it('renders label and value with unit', async () => {
    await render(<KeyValueRow label="C/N0" value={41} unit="dB-Hz" />);
    expect(screen.getByText('C/N0')).toBeTruthy();
    expect(screen.getByText('41 dB-Hz')).toBeTruthy();
  });

  it('renders a dash for missing values', async () => {
    await render(<KeyValueRow label="Residual" />);
    expect(screen.getByText(NOT_AVAILABLE)).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  it('marks the selected option and reports changes', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        label="Theme"
        value="system"
        onChange={onChange}
        options={[
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});

describe('StatusChip', () => {
  it('exposes source state to screen readers and handles press', async () => {
    const onPress = jest.fn();
    await render(<StatusChip source="usb" tone="ok" label="3D Fix" onPress={onPress} />);
    const chip = screen.getByRole('button', { name: /3D Fix/ });
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Banner', () => {
  it('renders message and action', async () => {
    const onAction = jest.fn();
    await render(
      <Banner
        tone="danger"
        message="USB permission denied"
        actionLabel="Try again"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('USB permission denied')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe('Card', () => {
  it('keeps the title indented when the content is flush (edge-to-edge rows)', async () => {
    await render(
      <Card title="Settings" flush>
        <Text>row</Text>
      </Card>,
    );
    // The title row is the nearest ancestor laid out as a row.
    let node = screen.getByText('Settings').parent;
    while (node && StyleSheet.flatten(node.props.style)?.flexDirection !== 'row')
      node = node.parent;
    expect(StyleSheet.flatten(node?.props.style)).toMatchObject({ paddingHorizontal: 16 });
  });
});
