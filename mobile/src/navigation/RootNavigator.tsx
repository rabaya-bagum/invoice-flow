import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, useColorScheme } from 'react-native';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LockScreen } from '../screens/LockScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { VerifyEmailScreen } from '../screens/VerifyEmailScreen';
import { useAuth } from '../store/auth';
import type { AppStackParams, AuthStackParams } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParams>();
const AppStack = createNativeStackNavigator<AppStackParams>();

/** Chooses the screen tree from auth state: loading, auth flow, password recovery, lock, app. */
export function RootNavigator() {
  const { status, locked } = useAuth();
  const dark = useColorScheme() === 'dark';

  let content;
  if (status === 'loading') {
    content = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </View>
    );
  } else if (status === 'recovery') {
    content = <ResetPasswordScreen />;
  } else if (status === 'signedOut') {
    content = (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="Login" component={LoginScreen} />
        <AuthStack.Screen name="SignUp" component={SignUpScreen} />
        <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        <AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      </AuthStack.Navigator>
    );
  } else if (locked) {
    content = <LockScreen />;
  } else {
    content = (
      <AppStack.Navigator>
        <AppStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <AppStack.Screen name="Settings" component={SettingsScreen} />
      </AppStack.Navigator>
    );
  }

  return (
    <NavigationContainer theme={dark ? DarkTheme : DefaultTheme}>{content}</NavigationContainer>
  );
}
