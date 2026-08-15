import type { PublicBlockProjection } from '../domain/projections';

interface ProjectedPublicBlockProps {
  block: PublicBlockProjection;
}

const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const recordList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];

export const ProjectedPublicBlock = ({ block }: ProjectedPublicBlockProps) => {
  const payload = block.payload || {};
  const eyebrow = typeof payload.eyebrow === 'string' ? payload.eyebrow : 'Projection publique vérifiée';
  const heading = typeof payload.heading === 'string' ? payload.heading : block.title;
  const paragraphs = textList(payload.paragraphs);
  const facts = recordList(payload.facts);
  const groups = recordList(payload.groups);
  const heroAsset = block.assets.find((asset) => asset.mediaKind === 'image' && asset.downloadUrl);

  return (
    <section className="projected-public-block" data-public-block={block.blockId}>
      {heroAsset?.downloadUrl && (
        <figure className="projected-public-block__media">
          <img src={heroAsset.downloadUrl} alt={heading} />
        </figure>
      )}
      <div className="projected-public-block__content">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{heading}</h2>
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {facts.length > 0 && (
          <dl className="projected-public-block__facts">
            {facts.map((fact, index) => (
              <div key={index}>
                <dt>{String(fact.label ?? '')}</dt>
                <dd>{String(fact.value ?? '')}</dd>
              </div>
            ))}
          </dl>
        )}
        {groups.map((group, groupIndex) => (
          <article className="projected-public-block__group" key={groupIndex}>
            <h3>{String(group.title ?? '')}</h3>
            <dl>
              {recordList(group.items).map((item, itemIndex) => (
                <div key={itemIndex}>
                  <dt>{String(item.label ?? '')}</dt>
                  <dd>{String(item.value ?? '')}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
};
