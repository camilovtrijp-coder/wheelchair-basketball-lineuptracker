import { translate, type Lang, type StringKey } from '../../i18n/strings';

const ERROR_CODE_TO_KEY: Record<string, StringKey> = {
  'auth/invalid-credential': 'authInvalidCredentialError',
  'auth/wrong-password': 'authInvalidCredentialError',
  'auth/user-not-found': 'authInvalidCredentialError',
  'auth/email-already-in-use': 'authEmailInUseError',
  'auth/weak-password': 'authWeakPasswordError',
  'auth/invalid-email': 'authInvalidEmailError',
};

export function authErrorMessage(lang: Lang, errorCode: string | undefined): string {
  const key = (errorCode && ERROR_CODE_TO_KEY[errorCode]) || 'authGenericError';
  return translate(lang, key);
}
