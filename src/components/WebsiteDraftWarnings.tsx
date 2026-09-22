import { websiteDraftVideosWithoutPublicCopy, type buildWebsiteDraft } from '../domain/websiteDraft';

export function WebsiteDraftWarnings({ blocks, language = 'FR' }: {
  blocks: ReturnType<typeof buildWebsiteDraft>; language?: 'FR' | 'EN';
}) {
  const excluded = blocks.filter((block) => block.excludedTextCount > 0);
  const videos = websiteDraftVideosWithoutPublicCopy(blocks);
  if (!excluded.length && !videos.length) return null;
  return <>
    {excluded.length > 0 && <aside role="status" className="publication-content-warning">
      <h3>{language === 'FR' ? 'Certains textes ne seront pas publiés' : 'Some text will not be published'}</h3>
      <p>{language === 'FR'
        ? 'Le filtre de confidentialité a écarté des textes dans les rubriques ci-dessous. Vérifiez l’aperçu public et, si nécessaire, reformulez le contenu source sans données personnelles ni références à des fichiers privés.'
        : 'The privacy filter excluded text in the sections below. Check the public preview and, if needed, revise the source without personal data or private file references.'}</p>
      <ul>{excluded.map((block) => <li key={block.id}>{block.title} — {block.excludedTextCount} {language === 'FR' ? 'texte(s) écarté(s)' : 'text item(s) excluded'}</li>)}</ul>
    </aside>}
    {videos.length > 0 && <aside role="status" className="publication-content-warning">
      <h3>{language === 'FR' ? `${videos.length} vidéo(s) sans copie publique vérifiée connue — publication refusée par le serveur` : `${videos.length} video(s) without a known verified public copy — publication refused by the server`}</h3>
      <p>{language === 'FR'
        ? 'Le serveur refuse toute la publication tant qu’il n’a pas produit de copie transcodée d’une vidéo « Tous » sélectionnée. Repassez ces vidéos en Secret ou retirez-les de la sélection pour publier le reste.'
        : 'The server refuses the whole publication until it has produced a transcoded copy of a selected “All” video. Set these videos back to Secret or remove them from the selection to publish the rest.'}</p>
      <ul>{videos.map((asset) => <li key={asset.id}>{asset.name}</li>)}</ul>
    </aside>}
  </>;
}
