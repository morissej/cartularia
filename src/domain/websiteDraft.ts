import { filterPublicationBlockIds, PUBLICATION_BLOCK_CATALOG } from './publication';
import type { PublicBlockProjection } from './projections';
import type { Asset } from '../types';
import { findPrivatePublicTextToken } from '../../scripts/lib/public-text-policy.mjs';

export interface WebsiteDraftBlock {
  id: string;
  title: string;
  payload: Record<string, unknown>;
  assets: Array<{ assetId: string; binaryId: string }>;
}
export interface WebsiteDraftContent {
  brand: string; model: string; reference: string;
  assets: Asset[];
  heroSummary?: string;
  history?: string[];
  specifications?: Array<{ title: string; items: Array<{ label: string; value: string }> }>;
  checks?: Array<{ label: string; result?: string; note?: string }>;
  description?: string[];
  conditionSummary?: string[];
  reports?: Array<{ title: string; date: string; note?: string }>;
  resources?: Array<{ name: string; url: string }>;
}
const safePreviewUrl = (asset: Asset) => asset.visibility === 'Tous' && !asset.binaryId && asset.url.startsWith('/assets/') ? asset.url : null;

export function buildWebsiteDraft(content: WebsiteDraftContent, selection: readonly string[]) {
  return filterPublicationBlockIds('website', selection).map((id) => {
    const title = PUBLICATION_BLOCK_CATALOG.find((block) => block.id === id)!.title;
    let excludedTextCount = 0;
    const safeText = (value: unknown): value is string => {
      if (typeof value !== 'string' || !value.trim()) return false;
      if (findPrivatePublicTextToken(value)) { excludedTextCount += 1; return false; }
      return true;
    };
    const paragraphs = (values: unknown[]) => values.filter(safeText);
    const assets = content.assets.filter((asset) => asset.status === 'Archived' && asset.visibility === 'Tous' && (
      id === 'media-library' ? true : id === 'media-hero' || id === 'cover-watch' ? asset.tags.includes('main-photo')
      : id === 'media-motion' ? asset.tags.includes('main-video') : id === 'media-spin' ? asset.tags.includes('spin-3d') && asset.type === 'image'
      : id === 'media-slideshow' ? asset.tags.includes('slideshow') : false
    ));
    const payload: Record<string, unknown> = { heading: title };
    if (id === 'cover-watch' || id === 'media-hero') {
      payload.heading = paragraphs([content.brand, content.model]).join(' · ') || title;
      payload.facts = safeText(content.reference) ? [{ label: 'Référence', value: content.reference }] : [];
      payload.paragraphs = paragraphs([content.heroSummary]);
    } else if (id === 'reference-history') payload.paragraphs = paragraphs(content.history || []);
    else if (id === 'reference-specs') payload.groups = (content.specifications || []).map((group) => ({
      title: safeText(group.title) ? group.title : 'Caractéristiques',
      items: group.items.filter((item) => safeText(item.label) && safeText(item.value)),
    }));
    else if (id === 'reference-checks') payload.facts = (content.checks || []).filter((item) => safeText(item.label)).map((item) => ({ label: item.label, value: paragraphs([item.result, item.note]).join(' · ') }));
    else if (id === 'reference-popularity') payload.resources = (content.resources || []).filter((item) => safeText(item.name) && /^https?:\/\//i.test(item.url) && safeText(item.url));
    else if (id === 'condition-description') payload.paragraphs = paragraphs(content.description || []);
    else if (id === 'condition-summary') payload.paragraphs = paragraphs(content.conditionSummary || []);
    else if (id === 'condition-reference-report' || id === 'condition-prior-reviews') payload.paragraphs = paragraphs((id === 'condition-reference-report' ? (content.reports || []).slice(0, 1) : (content.reports || []).slice(1)).flatMap((item) => [item.title, item.date, item.note]));
    payload.mediaLabels = assets.map((asset, index) => safeText(asset.name) ? asset.name : `Média ${index + 1}`);
    return { id, title, payload, assets, excludedTextCount };
  });
}

export function websiteDraftRequest(blocks: ReturnType<typeof buildWebsiteDraft>): WebsiteDraftBlock[] {
  return blocks.map((block) => ({ id: block.id, title: block.title, payload: block.payload,
    assets: block.assets.map((asset) => ({ assetId: asset.id, binaryId: asset.binaryId || '' })),
  }));
}

export function websiteDraftPreview(blocks: ReturnType<typeof buildWebsiteDraft>): PublicBlockProjection[] {
  return blocks.map((block) => ({ blockId: block.id, title: block.title, payload: block.payload, sourceRevision: 0,
    publicationStatus: 'published', contentHash: '', assets: block.assets.map((asset) => ({
      assetId: asset.id, derivativeId: `preview-${asset.id}`, mediaKind: asset.type, mimeType: asset.mimeType || '',
      storagePath: '', contentHash: '', downloadUrl: safePreviewUrl(asset),
    })),
  }));
}
