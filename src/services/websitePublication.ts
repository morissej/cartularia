import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { WebsiteDraftBlock } from '../domain/websiteDraft';

export interface WebsitePublicationState { cartularyId: string; publicCode: string; revision: number; status: 'draft' | 'published' | 'revoked'; blockIds: string[]; selectedAssetIds?: string[]; cleanupPending?: boolean; pendingCleanupCount?: number }
export interface WebsitePublicationRequest { cartularyId: string; requestId: string; expectedRevision: number; confirmed: true; confirmedNonPersonalMedia?: true; cleanupOnly?: true; blocks?: WebsiteDraftBlock[] }
export const loadWebsitePublicationState = async (cartularyId: string) => (await httpsCallable<{ cartularyId: string }, WebsitePublicationState>(functions, 'getCartularyWebsiteState')({ cartularyId })).data;
export const publishWebsiteSelection = async (request: WebsitePublicationRequest) => (await httpsCallable<WebsitePublicationRequest, WebsitePublicationState>(functions, 'publishCartularyWebsite', { timeout: 180000 })(request)).data;
export const revokeWebsiteSelection = async (request: WebsitePublicationRequest) => (await httpsCallable<WebsitePublicationRequest, WebsitePublicationState>(functions, 'revokeCartularyWebsite', { timeout: 180000 })(request)).data;
