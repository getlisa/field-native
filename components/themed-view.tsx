import { View, type ViewProps } from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({ style, lightColor, darkColor, ...otherProps }: ThemedViewProps) {
  const { colors, colorScheme } = useTheme();
  
  // Use override colors if provided, otherwise use theme
  const backgroundColor = colorScheme === 'dark' 
    ? (darkColor ?? colors.background) 
    : (lightColor ?? colors.background);

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
