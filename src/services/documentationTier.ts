import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.ts';
import type { DocumentationAssessmentProjection, RegistryDocumentationSummary } from '../domain/projections.ts';

export const observeDocumentationAssessment = (
  cartularyId: string,
  onAssessment: (assessment: DocumentationAssessmentProjection | null) => void,
  onError: (error: Error) => void,
) => onSnapshot(
  doc(db, 'cartularies', cartularyId, 'documentationAssessments', 'current'),
  (snapshot) => onAssessment(snapshot.exists() ? snapshot.data() as DocumentationAssessmentProjection : null),
  onError,
);

export const requestRegistryDocumentationSummary = async (registryId: string, asOfDate: string) => {
  const requestSummary = httpsCallable<
    { registryId: string; asOfDate: string },
    RegistryDocumentationSummary
  >(functions, 'getRegistryDocumentationSummary');
  return (await requestSummary({ registryId, asOfDate })).data;
};
