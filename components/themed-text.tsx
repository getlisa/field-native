import { StyleSheet, Text, type TextProps } from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { FontSizes } from '@/constants/theme';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link' | 'caption' | 'label';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const { colors, colorScheme } = useTheme();
  
  // Use override colors if provided, otherwise use theme
  const color = colorScheme === 'dark' 
    ? (darkColor ?? colors.text) 
    : (lightColor ?? colors.text);

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? [styles.link, { color: colors.primary }] : undefined,
        type === 'caption' ? [styles.caption, { color: colors.textSecondary }] : undefined,
        type === 'label' ? [styles.label, { color: colors.textTertiary }] : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: FontSizes.lg,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: FontSizes.lg,
    lineHeight: 24,
    fontWeight: '600',
  },
  title: {
    fontSize: FontSizes['4xl'],
    fontWeight: 'bold',
    lineHeight: 40,
  },
  subtitle: {
    fontSize: FontSizes['2xl'],
    fontWeight: 'bold',
  },
  link: {
    lineHeight: 30,
    fontSize: FontSizes.lg,
  },
  caption: {
    fontSize: FontSizes.sm,
    lineHeight: 18,
  },
  label: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
