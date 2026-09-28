import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { NotificationBell } from '@/components/notification-bell';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={icon} color={color as string} size={size} />,
});

export default function TabsLayout() {
  // Maintenance users work on corrective actions only.
  const pm = useAuth().profile?.role !== 'maintenance';
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarStyle: { minHeight: 64 },
        headerRight: () => <NotificationBell />,
      }}
    >
      <Tabs.Screen name="index" options={tab('Home', 'home')} />
      <Tabs.Screen name="sites" options={{ ...tab('My Sites', 'location'), ...(pm ? {} : { href: null }) }} />
      <Tabs.Screen name="pm" options={{ ...tab('PM Schedule', 'clipboard'), ...(pm ? {} : { href: null }) }} />
      <Tabs.Screen name="actions" options={tab('Actions', 'construct')} />
      <Tabs.Screen name="profile" options={tab('Profile', 'person-circle')} />
    </Tabs>
  );
}
