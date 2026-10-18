import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';

export const defaultNS = 'translation';
export const resources = { en: { translation: en } } as const;

const i18n = createInstance();

// English only in v1 (REQ-NFR-12); all user-visible strings live in en.json.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  defaultNS,
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18n;
