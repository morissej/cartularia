export interface CommunityProfile {
  uid: string;
  pseudonym: string;
  bio: string;
  avatarAssetId: string | null;
  status: 'active' | 'suspended';
  visibility: 'community';
}

export interface CommunityPublication {
  publicationId: string;
  audience: 'community';
  assetType: string;
  schemaVersion: string;
  displayTitle: string;
  makerName: string;
  modelName: string;
  referenceCode: string | null;
  status: 'published' | 'suspended' | 'revoked';
  publicationStatus: 'published' | 'suspended' | 'revoked';
  moderationStatus: 'approved' | 'suspended';
  sourceRevision: number;
  blockIds: string[];
  contentHash: string;
  publishedAtIso: string;
}

export interface CommunityBlock {
  publicationId: string;
  blockId: string;
  title: string;
  order: number;
  audience: 'community';
  fields: Record<string, unknown>;
  fieldIds: string[];
  sourceRevision: number;
  contentHash: string;
}

export interface CommunityPost {
  postId: string;
  communityPublicationId: string;
  authorProfileId: string;
  authorPseudonym: string;
  body: string;
  status: 'active' | 'hidden';
  moderationStatus: 'visible' | 'hidden';
  commentCount: number;
  reactionCount: number;
  contentHash: string;
  publishedAtIso: string;
}

export interface CommunityComment {
  commentId: string;
  postId: string;
  authorProfileId: string;
  authorPseudonym: string;
  body: string;
  status: 'visible' | 'hidden';
  proofStatus: 'not_cartulary_evidence';
  contentHash: string;
  createdAtIso: string;
}

export interface LoadedCommunityPost {
  post: CommunityPost;
  profile: CommunityProfile | null;
  publication: CommunityPublication;
  blocks: CommunityBlock[];
  comments: CommunityComment[];
}

export interface LoadedCommunityPublication {
  publication: CommunityPublication;
  blocks: CommunityBlock[];
}
