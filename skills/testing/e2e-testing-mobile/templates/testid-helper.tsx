// setTestId — cross-platform helper for React Native testID props.
//
// Why this helper exists:
//
// 1. testID and accessibilityLabel must NOT share a value. The label
//    belongs to screen readers; the testID belongs to E2E flows.
//    Reusing one as the other breaks accessibility under translation
//    and breaks tests under copy edits. See:
//    skills/testing/e2e-testing-mobile/rules/locator-strategy.md
//
// 2. testID semantics are platform-specific:
//    - iOS:     becomes accessibilityIdentifier on the native view.
//    - Android: becomes the resource-id on the native view (RN 0.64+).
//
//    Both are picked up by Maestro's `id:` matcher without a package
//    prefix. If you ever drop down to Appium for the same flow, Appium
//    on Android requires the `<package>:id/<value>` form — but Maestro
//    does not.
//
// 3. Spreading the helper's return value keeps the prop list tidy and
//    avoids accidental string concatenation between testID and
//    accessibilityLabel.

import type { AccessibilityProps, ViewProps } from 'react-native';
import { Platform } from 'react-native';

type TestIdProps = Pick<ViewProps, 'testID'> &
  Pick<AccessibilityProps, 'accessible'>;

/**
 * Returns the testing identifier props for a component.
 *
 * Spread the result onto the native primitive — do NOT pass it to a
 * library wrapper that swallows unknown props.
 *
 * Usage:
 *   <Pressable
 *     onPress={onSignIn}
 *     accessibilityLabel="Sign in"
 *     {...setTestId('sign-in-button')}
 *   />
 *
 * @param testID Kebab-case identifier (e.g. 'sign-in-button').
 *               Stable across i18n; never a user-visible string.
 */
export function setTestId(testID: string): TestIdProps {
  if (Platform.OS === 'android') {
    // Android: resource-id is set from testID. We mark `accessible: true`
    // so the View is exposed as a single accessibility node, which lets
    // UIAutomator (and Maestro) target it as one element rather than
    // walking into its children.
    return {
      testID,
      accessible: true,
    };
  }

  // iOS: testID becomes accessibilityIdentifier. The default RN behaviour
  // is fine; we don't force `accessible: true` because that would collapse
  // the children's a11y tree and degrade VoiceOver UX for groups.
  return {
    testID,
  };
}
