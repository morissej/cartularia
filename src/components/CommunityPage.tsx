import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import type { LoadedCommunityPost } from '../domain/community.ts';
import { loadCommunityFeed } from '../services/community.ts';
import { formatGenericValue } from '../schema/fieldPresentation.ts';
import { BrandLogo } from './BrandLogo';

type CommunityState = 'auth-loading' | 'signed-out' | 'loading' | 'ready' | 'denied';

export const CommunityPage = () => {
  const [state, setState] = useState<CommunityState>('auth-loading');
  const [feed, setFeed] = useState<LoadedCommunityPost[]>([]);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) {
      setFeed([]);
      setState('signed-out');
      return;
    }
    setState('loading');
    loadCommunityFeed()
      .then((loaded) => {
        setFeed(loaded);
        setState('ready');
      })
      .catch(() => setState('denied'));
  }), []);

  if (state !== 'ready') {
    const heading = state === 'denied'
      ? 'Admission communautaire requise'
      : state === 'signed-out'
        ? 'Communauté privée'
        : 'Chargement de la communauté';
    return (
      <main className="community-state">
        <BrandLogo />
        <h1>{heading}</h1>
        <p>Cette surface est réservée aux profils authentifiés et admis. Elle ne lit jamais le Cartulaire maître.</p>
      </main>
    );
  }

  return (
    <div className="community-page">
      <header className="community-page__header">
        <BrandLogo />
        <div>
          <span className="eyebrow">Cercle pilote · accès authentifié</span>
          <h1>Communauté Cartularia</h1>
          <p>Publications choisies, profils pseudonymes et échanges sans accès au dossier patrimonial.</p>
        </div>
      </header>

      <main className="community-feed">
        {feed.length === 0 && (
          <section className="community-empty">
            <h2>Aucune publication active</h2>
            <p>Une publication suspendue par la modération disparaît immédiatement de cette surface.</p>
          </section>
        )}
        {feed.map(({ post, profile, publication, blocks, comments }) => (
          <article className="community-post" key={post.postId}>
            <header className="community-post__author">
              <div className="community-avatar" aria-hidden="true">
                {(profile?.pseudonym ?? post.authorPseudonym).slice(0, 2).toUpperCase()}
              </div>
              <div>
                <strong>{profile?.pseudonym ?? post.authorPseudonym}</strong>
                <span>Profil communautaire · {post.publishedAtIso.slice(0, 10)}</span>
              </div>
            </header>
            <p className="community-post__body">{post.body}</p>

            <section className="community-publication-card">
              <span className="eyebrow">Projection community · {publication.assetType}</span>
              <h2>{publication.displayTitle}</h2>
              <p>{publication.makerName} · {publication.modelName}</p>
              {blocks.map((block) => (
                <div className="community-block" key={block.blockId}>
                  <h3>{block.title}</h3>
                  <dl>
                    {Object.entries(block.fields).map(([fieldId, value]) => (
                      <div key={fieldId}>
                        <dt>{fieldId}</dt>
                        <dd>{formatGenericValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </section>

            <div className="community-post__counts">
              <span>{post.reactionCount} réaction{post.reactionCount > 1 ? 's' : ''}</span>
              <span>{post.commentCount} commentaire{post.commentCount > 1 ? 's' : ''}</span>
            </div>
            {comments.length > 0 && (
              <section className="community-comments" aria-label="Commentaires">
                {comments.map((comment) => (
                  <div key={comment.commentId}>
                    <strong>{comment.authorPseudonym}</strong>
                    <p>{comment.body}</p>
                    <small>Échange communautaire · aucune valeur de preuve</small>
                  </div>
                ))}
              </section>
            )}
          </article>
        ))}
      </main>
    </div>
  );
};
