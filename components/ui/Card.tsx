import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, Spacing } from '@/constants/theme';

export type CardVariant = 'default' | 'outlined' | 'elevated';

interface BaseCardProps {
  /** Visual variant */
  variant?: CardVariant;
  /** Padding size */
  padding?: keyof typeof Spacing | number;
  /** Custom style */
  style?: StyleProp<ViewStyle>;
}

interface StaticCardProps extends BaseCardProps, Omit<ViewProps, 'style' | 'children'> {
  /** Not pressable */
  pressable?: false;
  /** Children */
  children?: React.ReactNode;
}

interface PressableCardProps extends BaseCardProps, Omit<PressableProps, 'style' | 'children'> {
  /** Pressable card */
  pressable: true;
  /** Children */
  children?: React.ReactNode;
}

type CardProps = StaticCardProps | PressableCardProps;

export const Card: React.FC<CardProps> = ({
  variant = 'default',
  padding = 'lg',
  style,
  children,
  ...props
}) => {
  const { colors, shadows } = useTheme();

  const paddingValue = typeof padding === 'number' ? padding : Spacing[padding];

  const getVariantStyles = (): ViewStyle => {
    switch (variant) {
      case 'default':
        return {
          backgroundColor: colors.cardBackground,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          ...shadows.sm,
        };
      case 'outlined':
        return {
          backgroundColor: colors.cardBackground,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        };
      case 'elevated':
        return {
          backgroundColor: colors.cardBackground,
          ...shadows.md,
        };
    }
  };

  const cardStyle: ViewStyle = {
    borderRadius: BorderRadius.lg,
    padding: paddingValue,
    ...getVariantStyles(),
  };

  if ((props as PressableCardProps).pressable) {
    const { pressable, ...pressableProps } = props as PressableCardProps;
    return (
      <Pressable
        style={({ pressed }) => [
          cardStyle,
          pressed && { backgroundColor: colors.cardPressed },
          style,
        ]}
        {...pressableProps}
      >
        {children}
      </Pressable>
    );
  }

  const { pressable, ...viewProps } = props as StaticCardProps;
  return (
    <View style={[cardStyle, style]} {...viewProps}>
      {children}
    </View>
  );
};

// Card Header component
interface CardHeaderProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ style, children, ...props }) => {
  return (
    <View style={[styles.header, style]} {...props}>
      {children}
    </View>
  );
};

// Card Body component
interface CardBodyProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

export const CardBody: React.FC<CardBodyProps> = ({ style, children, ...props }) => {
  return (
    <View style={[styles.body, style]} {...props}>
      {children}
    </View>
  );
};

// Card Footer component
interface CardFooterProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

export const CardFooter: React.FC<CardFooterProps> = ({ style, children, ...props }) => {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.footer,
        { borderTopColor: colors.border },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: Spacing.md,
  },
  body: {
    gap: Spacing.sm,
  },
  footer: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
});

export default Card;
