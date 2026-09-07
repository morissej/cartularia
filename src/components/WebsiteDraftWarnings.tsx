import type { buildWebsiteDraft } from '../domain/websiteDraft';

export function WebsiteDraftWarnings({ blocks, language = 'FR' }: {
  blocks: ReturnType<typeof buildWebsiteDraft>; language?: 'FR' | 'EN';
}) {
  const excluded = blocks.filter((block) => block.excludedTextCount > 0);
  if (!excluded.length) return null;
  return <aside role="status" className="publication-content-warning">
    <h3>{language === 'FR' ? 'Certains textes ne seront pas publiés' : 'Some text will not be published'}</h3>
    <p>{language === 'FR'
      ? 'Le filtre de confidentialité a écarté des textes dans les rubriques ci-dessous. Vérifiez l’aperçu public et, si nécessaire, reformulez le contenu source sans données personnelles ni références à des fichiers privés.'
      : 'The privacy filter excluded text in the sections below. Check the public preview and, if needed, revise the source without personal data or private file references.'}</p>
    <ul>{excluded.map((block) => <li key={block.id}>{block.title} — {block.excludedTextCount} {language === 'FR' ? 'texte(s) écarté(s)' : 'text item(s) excluded'}</li>)}</ul>
  </aside>;
}
