import { translate, type Lang } from '../../i18n/strings';

export interface LastModifiedProps {
  lang: Lang;
  updatedAt?: number;
  testId: string;
}

export function LastModified({ lang, updatedAt, testId }: LastModifiedProps) {
  if (updatedAt === undefined) return null;

  const formatted = new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(updatedAt));

  return (
    <p className="last-modified" data-testid={testId} role="status">
      {translate(lang, 'lastModifiedLabel')}: {formatted}
    </p>
  );
}
